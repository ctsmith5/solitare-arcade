package main

import (
	"context"
	"database/sql"
	"encoding/json"
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

-- One row per player per game: a personal best, not a history. Lower scores
-- are never stored, so the table stays the source of truth for the combined
-- arcade total.
CREATE TABLE IF NOT EXISTS scores (
    id               BIGSERIAL PRIMARY KEY,
    player_id        BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game             TEXT    NOT NULL DEFAULT 'solitaire',
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
	`ALTER TABLE scores ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'solitaire'`,

	// Scores used to be a full history. Collapse each player's runs down to
	// their best per game, keeping the earliest row on a tie, so the unique
	// index below can be created and the table means "personal best".
	`DELETE FROM scores s
	 USING scores other
	 WHERE s.player_id = other.player_id
	   AND s.game = other.game
	   AND (other.score > s.score OR (other.score = s.score AND other.id < s.id))`,

	`CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_player_game ON scores(player_id, game)`,
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
	// TotalScore is the arcade total: the player's best in each game, summed.
	TotalScore int `json:"total_score"`
	// BestScore is the single highest game best, kept for per-game display.
	BestScore int            `json:"best_score"`
	GamesWon  int            `json:"games_won"`
	Games     int            `json:"games_played"`
	Bests     map[string]int `json:"bests"`
}

type Score struct {
	ID         int64  `json:"id"`
	PlayerID   int64  `json:"player_id"`
	PlayerName string `json:"player_name"`
	Game       string `json:"game"`
	Score      int    `json:"score"`
	Moves      int    `json:"moves"`
	Duration   int    `json:"duration_seconds"`
	Won        bool   `json:"won"`
	Difficulty string `json:"difficulty"`
	CreatedAt  string `json:"created_at"`
}

// LeaderboardEntry is one row of the arcade high-score table. Rows are players,
// not runs: the cabinet ranks on the combined total across every game.
type LeaderboardEntry struct {
	Rank       int            `json:"rank"`
	PlayerID   int64          `json:"player_id"`
	PlayerName string         `json:"player_name"`
	TotalScore int            `json:"total_score"`
	Games      int            `json:"games_played"`
	GamesWon   int            `json:"games_won"`
	Bests      map[string]int `json:"bests"`
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

// Games the cabinet knows about. Unknown values fall back to solitaire rather
// than being rejected, for the same reason as difficulty: the run is over.
var validGames = map[string]bool{"solitaire": true, "sudoku": true, "wordle": true}

func NormalizeGame(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if validGames[value] {
		return value
	}
	return "solitaire"
}

const timestampLayout = time.RFC3339

// ---- players ------------------------------------------------------------

// Each score row is already a personal best, so summing them gives the arcade
// total directly — no per-game MAX subquery needed.
const playerSelect = `
SELECT p.id,
       p.name,
       p.created_at,
       COALESCE(SUM(s.score), 0)     AS total_score,
       COALESCE(MAX(s.score), 0)     AS best_score,
       COUNT(*) FILTER (WHERE s.won) AS games_won,
       COUNT(s.id)                   AS games_played,
       COALESCE(
         json_object_agg(s.game, s.score) FILTER (WHERE s.game IS NOT NULL),
         '{}'
       ) AS bests
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
			bests   []byte
		)
		if err := rows.Scan(&p.ID, &p.Name, &created, &p.TotalScore, &p.BestScore,
			&p.GamesWon, &p.Games, &bests); err != nil {
			return nil, err
		}
		p.CreatedAt = created.UTC().Format(timestampLayout)
		p.Bests = map[string]int{}
		if len(bests) > 0 {
			if err := json.Unmarshal(bests, &p.Bests); err != nil {
				return nil, fmt.Errorf("decode bests: %w", err)
			}
		}
		players = append(players, p)
	}
	return players, rows.Err()
}

func (s *Store) ListPlayers() ([]Player, error) {
	rows, err := s.db.Query(playerSelect + `
GROUP BY p.id
ORDER BY total_score DESC, p.name ASC`)
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

// SubmitScore records a run only if it beats the player's existing best for
// that game. Returns the stored best and whether this run replaced it.
//
// Lower runs are deliberately not persisted: the scores table holds one row per
// player per game, so it is the arcade total by construction rather than
// something that has to be recomputed from a history.
func (s *Store) SubmitScore(playerID int64, game string, score, moves, duration int, won bool, difficulty string) (*Score, bool, error) {
	if _, err := s.GetPlayer(playerID); err != nil {
		return nil, false, err
	}
	game = NormalizeGame(game)

	const returning = `RETURNING id, player_id, game, score, moves, duration_seconds, won, difficulty, created_at`

	row := s.db.QueryRow(`
INSERT INTO scores (player_id, game, score, moves, duration_seconds, won, difficulty)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (player_id, game) DO UPDATE
SET score            = EXCLUDED.score,
    moves            = EXCLUDED.moves,
    duration_seconds = EXCLUDED.duration_seconds,
    won              = EXCLUDED.won,
    difficulty       = EXCLUDED.difficulty,
    created_at       = now()
WHERE EXCLUDED.score > scores.score
`+returning,
		playerID, game, score, moves, duration, won, NormalizeDifficulty(difficulty))

	stored, err := scanScore(row)
	switch {
	case err == nil:
		return stored, true, s.attachName(stored)
	case errors.Is(err, sql.ErrNoRows):
		// The WHERE guard rejected it, so the existing best stands. Hand it
		// back so the caller can show what the player has to beat.
		existing, err := s.BestScore(playerID, game)
		if err != nil {
			return nil, false, err
		}
		return existing, false, nil
	default:
		return nil, false, err
	}
}

// BestScore returns a player's stored best for one game.
func (s *Store) BestScore(playerID int64, game string) (*Score, error) {
	row := s.db.QueryRow(`
SELECT id, player_id, game, score, moves, duration_seconds, won, difficulty, created_at
FROM scores WHERE player_id = $1 AND game = $2`, playerID, NormalizeGame(game))

	stored, err := scanScore(row)
	if err != nil {
		return nil, err
	}
	return stored, s.attachName(stored)
}

type rowScanner interface{ Scan(dest ...any) error }

func scanScore(row rowScanner) (*Score, error) {
	var (
		out     Score
		created time.Time
	)
	if err := row.Scan(&out.ID, &out.PlayerID, &out.Game, &out.Score, &out.Moves,
		&out.Duration, &out.Won, &out.Difficulty, &created); err != nil {
		return nil, err
	}
	out.CreatedAt = created.UTC().Format(timestampLayout)
	return &out, nil
}

func (s *Store) attachName(sc *Score) error {
	return s.db.QueryRow(`SELECT name FROM players WHERE id = $1`, sc.PlayerID).Scan(&sc.PlayerName)
}

// Leaderboard ranks players by their combined total across every game.
func (s *Store) Leaderboard(limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 {
		limit = 5
	}
	rows, err := s.db.Query(`
SELECT p.id,
       p.name,
       SUM(s.score)                  AS total_score,
       COUNT(s.id)                   AS games_played,
       COUNT(*) FILTER (WHERE s.won) AS games_won,
       json_object_agg(s.game, s.score) AS bests
FROM players p
JOIN scores s ON s.player_id = p.id
GROUP BY p.id
ORDER BY total_score DESC, p.name ASC
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
		var bests []byte
		if err := rows.Scan(&e.PlayerID, &e.PlayerName, &e.TotalScore,
			&e.Games, &e.GamesWon, &bests); err != nil {
			return nil, err
		}
		e.Bests = map[string]int{}
		if len(bests) > 0 {
			if err := json.Unmarshal(bests, &e.Bests); err != nil {
				return nil, fmt.Errorf("decode bests: %w", err)
			}
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// PlayerScores lists a player's best in each game, highest first.
func (s *Store) PlayerScores(playerID int64, limit int) ([]Score, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.Query(`
SELECT s.id, s.player_id, p.name, s.game, s.score, s.moves, s.duration_seconds, s.won, s.difficulty, s.created_at
FROM scores s JOIN players p ON p.id = s.player_id
WHERE s.player_id = $1
ORDER BY s.score DESC
LIMIT $2`, playerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Score{}
	for rows.Next() {
		var sc Score
		var created time.Time
		if err := rows.Scan(&sc.ID, &sc.PlayerID, &sc.PlayerName, &sc.Game, &sc.Score,
			&sc.Moves, &sc.Duration, &sc.Won, &sc.Difficulty, &created); err != nil {
			return nil, err
		}
		sc.CreatedAt = created.UTC().Format(timestampLayout)
		out = append(out, sc)
	}
	return out, rows.Err()
}
