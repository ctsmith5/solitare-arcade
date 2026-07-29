package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite connection and all query logic for the arcade.
type Store struct {
	db *sql.DB
}

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score            INTEGER NOT NULL,
    moves            INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    won              INTEGER NOT NULL DEFAULT 0,
    difficulty       TEXT NOT NULL DEFAULT 'medium',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
`

func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// SQLite handles a single writer at a time; keep the pool small and honest.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := addMissingColumns(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

// addMissingColumns brings a database created by an older build up to date.
// CREATE TABLE IF NOT EXISTS leaves existing tables alone, so new columns have
// to be added explicitly.
func addMissingColumns(db *sql.DB) error {
	added := []struct{ table, column, ddl string }{
		{"scores", "difficulty", `ALTER TABLE scores ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium'`},
	}
	for _, c := range added {
		has, err := hasColumn(db, c.table, c.column)
		if err != nil {
			return err
		}
		if has {
			continue
		}
		if _, err := db.Exec(c.ddl); err != nil {
			return fmt.Errorf("add %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

func hasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return true, rows.Err()
		}
	}
	return false, rows.Err()
}

// Difficulties the cabinet accepts; anything else falls back to medium.
var validDifficulties = map[string]bool{"easy": true, "medium": true, "hard": true}

// NormalizeDifficulty keeps unknown values out of the database without
// rejecting a run the player already finished.
func NormalizeDifficulty(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if validDifficulties[value] {
		return value
	}
	return "medium"
}

func (s *Store) Close() error { return s.db.Close() }

// ---- models -------------------------------------------------------------

type Player struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	BestScore int    `json:"best_score"`
	GamesWon  int    `json:"games_won"`
	Games     int    `json:"games_played"`
}

type Score struct {
	ID         int64  `json:"id"`
	PlayerID   int64  `json:"player_id"`
	PlayerName string `json:"player_name"`
	Score      int    `json:"score"`
	Moves      int    `json:"moves"`
	Duration   int    `json:"duration_seconds"`
	Won        bool   `json:"won"`
	Difficulty string `json:"difficulty"`
	CreatedAt  string `json:"created_at"`
}

// LeaderboardEntry is one row of the arcade high-score table.
type LeaderboardEntry struct {
	Rank       int    `json:"rank"`
	PlayerID   int64  `json:"player_id"`
	PlayerName string `json:"player_name"`
	Score      int    `json:"score"`
	Moves      int    `json:"moves"`
	Duration   int    `json:"duration_seconds"`
	Won        bool   `json:"won"`
	Difficulty string `json:"difficulty"`
	CreatedAt  string `json:"created_at"`
}

var (
	ErrPlayerExists   = errors.New("player already exists")
	ErrPlayerNotFound = errors.New("player not found")
	ErrInvalidName    = errors.New("invalid player name")
)

// NormalizeName trims, collapses whitespace and upper-cases the handle so the
// leaderboard reads like a real cabinet. Returns ErrInvalidName if unusable.
func NormalizeName(raw string) (string, error) {
	name := strings.ToUpper(strings.Join(strings.Fields(raw), " "))
	if len(name) < 1 || len([]rune(name)) > 12 {
		return "", ErrInvalidName
	}
	for _, r := range name {
		ok := (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == ' ' || r == '-' || r == '_'
		if !ok {
			return "", ErrInvalidName
		}
	}
	return name, nil
}

// ---- players ------------------------------------------------------------

const playerSelect = `
SELECT p.id,
       p.name,
       p.created_at,
       COALESCE(MAX(s.score), 0)                        AS best_score,
       COALESCE(SUM(CASE WHEN s.won = 1 THEN 1 END), 0) AS games_won,
       COUNT(s.id)                                      AS games_played
FROM players p
LEFT JOIN scores s ON s.player_id = p.id
`

func scanPlayers(rows *sql.Rows) ([]Player, error) {
	defer rows.Close()
	players := []Player{}
	for rows.Next() {
		var p Player
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.BestScore, &p.GamesWon, &p.Games); err != nil {
			return nil, err
		}
		players = append(players, p)
	}
	return players, rows.Err()
}

func (s *Store) ListPlayers() ([]Player, error) {
	rows, err := s.db.Query(playerSelect + `
GROUP BY p.id
ORDER BY best_score DESC, p.name ASC`)
	if err != nil {
		return nil, err
	}
	return scanPlayers(rows)
}

func (s *Store) GetPlayer(id int64) (*Player, error) {
	rows, err := s.db.Query(playerSelect+`WHERE p.id = ? GROUP BY p.id`, id)
	if err != nil {
		return nil, err
	}
	players, err := scanPlayers(rows)
	if err != nil {
		return nil, err
	}
	if len(players) == 0 {
		return nil, ErrPlayerNotFound
	}
	return &players[0], nil
}

func (s *Store) GetPlayerByName(name string) (*Player, error) {
	rows, err := s.db.Query(playerSelect+`WHERE p.name = ? COLLATE NOCASE GROUP BY p.id`, name)
	if err != nil {
		return nil, err
	}
	players, err := scanPlayers(rows)
	if err != nil {
		return nil, err
	}
	if len(players) == 0 {
		return nil, ErrPlayerNotFound
	}
	return &players[0], nil
}

// CreatePlayer inserts a new handle. No passwords — this is an arcade cabinet.
func (s *Store) CreatePlayer(raw string) (*Player, error) {
	name, err := NormalizeName(raw)
	if err != nil {
		return nil, err
	}
	res, err := s.db.Exec(`INSERT INTO players (name, created_at) VALUES (?, ?)`,
		name, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, ErrPlayerExists
		}
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetPlayer(id)
}

// ---- scores -------------------------------------------------------------

func (s *Store) AddScore(playerID int64, score, moves, duration int, won bool, difficulty string) (*Score, error) {
	if _, err := s.GetPlayer(playerID); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(
		`INSERT INTO scores (player_id, score, moves, duration_seconds, won, difficulty, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		playerID, score, moves, duration, boolToInt(won), NormalizeDifficulty(difficulty), now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	var out Score
	var wonInt int
	err = s.db.QueryRow(`
SELECT s.id, s.player_id, p.name, s.score, s.moves, s.duration_seconds, s.won, s.difficulty, s.created_at
FROM scores s JOIN players p ON p.id = s.player_id
WHERE s.id = ?`, id).Scan(&out.ID, &out.PlayerID, &out.PlayerName, &out.Score,
		&out.Moves, &out.Duration, &wonInt, &out.Difficulty, &out.CreatedAt)
	if err != nil {
		return nil, err
	}
	out.Won = wonInt == 1
	return &out, nil
}

// Leaderboard returns the top N runs, arcade-cabinet style: one row per run,
// highest score first, earliest submission winning any tie.
func (s *Store) Leaderboard(limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 {
		limit = 5
	}
	rows, err := s.db.Query(`
SELECT s.player_id, p.name, s.score, s.moves, s.duration_seconds, s.won, s.difficulty, s.created_at
FROM scores s
JOIN players p ON p.id = s.player_id
ORDER BY s.score DESC, s.duration_seconds ASC, s.created_at ASC
LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []LeaderboardEntry{}
	rank := 0
	for rows.Next() {
		rank++
		e := LeaderboardEntry{Rank: rank}
		var wonInt int
		if err := rows.Scan(&e.PlayerID, &e.PlayerName, &e.Score, &e.Moves,
			&e.Duration, &wonInt, &e.Difficulty, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Won = wonInt == 1
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Store) PlayerScores(playerID int64, limit int) ([]Score, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.Query(`
SELECT s.id, s.player_id, p.name, s.score, s.moves, s.duration_seconds, s.won, s.difficulty, s.created_at
FROM scores s JOIN players p ON p.id = s.player_id
WHERE s.player_id = ?
ORDER BY s.score DESC, s.created_at DESC
LIMIT ?`, playerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Score{}
	for rows.Next() {
		var sc Score
		var wonInt int
		if err := rows.Scan(&sc.ID, &sc.PlayerID, &sc.PlayerName, &sc.Score,
			&sc.Moves, &sc.Duration, &wonInt, &sc.Difficulty, &sc.CreatedAt); err != nil {
			return nil, err
		}
		sc.Won = wonInt == 1
		out = append(out, sc)
	}
	return out, rows.Err()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
