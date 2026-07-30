package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Store wraps the Postgres connection and all query logic for the arcade.
type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS players (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
    id               BIGSERIAL PRIMARY KEY,
    player_id        BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score            INTEGER NOT NULL,
    moves            INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    won              BOOLEAN NOT NULL DEFAULT FALSE,
    difficulty       TEXT    NOT NULL DEFAULT 'medium',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
`

// Columns added after the first release. Postgres supports IF NOT EXISTS here,
// so replaying these on an up-to-date database is a no-op.
var migrations = []string{
	`ALTER TABLE scores ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium'`,
}

// OpenStore connects to Postgres and brings the schema up to date.
//
// dsn is a standard connection URL — on Railway that is the DATABASE_URL the
// Postgres service publishes.
func OpenStore(dsn string) (*Store, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, errors.New("no database URL configured (set DATABASE_URL)")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := waitForDB(db, 30*time.Second); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	for _, stmt := range migrations {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("migrate: %w", err)
		}
	}
	return &Store{db: db}, nil
}

// waitForDB gives the database a chance to come up. Platforms often start the
// app before its database is accepting connections, and dying immediately turns
// an ordinary cold start into a crash loop.
func waitForDB(db *sql.DB, limit time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()

	var lastErr error
	for {
		if err := db.PingContext(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("database unreachable after %s: %w", limit, lastErr)
		case <-time.After(time.Second):
		}
	}
}

func (s *Store) Close() error { return s.db.Close() }

// isUniqueViolation reports whether err is Postgres' unique_violation (23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

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
//
// Because every stored name is upper-cased, a plain UNIQUE constraint gives
// case-insensitive handles without needing a citext column.
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

const timestampLayout = time.RFC3339

// ---- players ------------------------------------------------------------

const playerSelect = `
SELECT p.id,
       p.name,
       p.created_at,
       COALESCE(MAX(s.score), 0)        AS best_score,
       COUNT(*) FILTER (WHERE s.won)    AS games_won,
       COUNT(s.id)                      AS games_played
FROM players p
LEFT JOIN scores s ON s.player_id = p.id
`

func scanPlayers(rows *sql.Rows) ([]Player, error) {
	defer rows.Close()
	players := []Player{}
	for rows.Next() {
		var (
			p       Player
			created time.Time
		)
		if err := rows.Scan(&p.ID, &p.Name, &created, &p.BestScore, &p.GamesWon, &p.Games); err != nil {
			return nil, err
		}
		p.CreatedAt = created.UTC().Format(timestampLayout)
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
	rows, err := s.db.Query(playerSelect+`WHERE p.id = $1 GROUP BY p.id`, id)
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

// GetPlayerByName finds a handle however the caller cased or spaced it.
//
// Stored names are always normalized, so normalizing the needle the same way
// makes an exact match case-insensitive — the job SQLite's COLLATE NOCASE used
// to do, and it collapses stray whitespace too. A name that cannot normalize
// could never have been stored, so it is simply not found.
func (s *Store) GetPlayerByName(raw string) (*Player, error) {
	name, err := NormalizeName(raw)
	if err != nil {
		return nil, ErrPlayerNotFound
	}

	rows, err := s.db.Query(playerSelect+`WHERE p.name = $1 GROUP BY p.id`, name)
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

	var id int64
	err = s.db.QueryRow(
		`INSERT INTO players (name) VALUES ($1) RETURNING id`, name,
	).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrPlayerExists
		}
		return nil, err
	}
	return s.GetPlayer(id)
}

// ---- scores -------------------------------------------------------------

func (s *Store) AddScore(playerID int64, score, moves, duration int, won bool, difficulty string) (*Score, error) {
	if _, err := s.GetPlayer(playerID); err != nil {
		return nil, err
	}

	var (
		out     Score
		created time.Time
	)
	err := s.db.QueryRow(`
INSERT INTO scores (player_id, score, moves, duration_seconds, won, difficulty)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, player_id, score, moves, duration_seconds, won, difficulty, created_at`,
		playerID, score, moves, duration, won, NormalizeDifficulty(difficulty),
	).Scan(&out.ID, &out.PlayerID, &out.Score, &out.Moves, &out.Duration,
		&out.Won, &out.Difficulty, &created)
	if err != nil {
		return nil, err
	}
	out.CreatedAt = created.UTC().Format(timestampLayout)

	if err := s.db.QueryRow(`SELECT name FROM players WHERE id = $1`, playerID).
		Scan(&out.PlayerName); err != nil {
		return nil, err
	}
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
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []LeaderboardEntry{}
	rank := 0
	for rows.Next() {
		rank++
		e := LeaderboardEntry{Rank: rank}
		var created time.Time
		if err := rows.Scan(&e.PlayerID, &e.PlayerName, &e.Score, &e.Moves,
			&e.Duration, &e.Won, &e.Difficulty, &created); err != nil {
			return nil, err
		}
		e.CreatedAt = created.UTC().Format(timestampLayout)
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
WHERE s.player_id = $1
ORDER BY s.score DESC, s.created_at DESC
LIMIT $2`, playerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Score{}
	for rows.Next() {
		var sc Score
		var created time.Time
		if err := rows.Scan(&sc.ID, &sc.PlayerID, &sc.PlayerName, &sc.Score,
			&sc.Moves, &sc.Duration, &sc.Won, &sc.Difficulty, &created); err != nil {
			return nil, err
		}
		sc.CreatedAt = created.UTC().Format(timestampLayout)
		out = append(out, sc)
	}
	return out, rows.Err()
}
