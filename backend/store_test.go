package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"testing"
)

var testDBSeq atomic.Int64

// testBaseURL is the admin connection these tests create scratch databases on.
// Without it there is nothing to test against, so the suite skips rather than
// fails — see the README for the one-line Docker command.
func testBaseURL(t *testing.T) string {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL is not set; see README > Tests")
	}
	return base
}

// onDatabase rewrites a connection URL to point at a different database.
func onDatabase(t *testing.T, raw, name string) string {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	parsed.Path = "/" + name
	return parsed.String()
}

// newTestStore gives every test its own freshly created database, so tests are
// fully isolated and safe to run in parallel.
func newTestStore(t *testing.T) *Store {
	t.Helper()

	base := testBaseURL(t)
	name := fmt.Sprintf("solitaire_test_%d_%d", os.Getpid(), testDBSeq.Add(1))

	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatalf("connect to %s: %v", base, err)
	}
	defer admin.Close()

	if _, err := admin.Exec("DROP DATABASE IF EXISTS " + name); err != nil {
		t.Fatalf("drop stale test database: %v", err)
	}
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatalf("create test database: %v", err)
	}

	store, err := OpenStore(onDatabase(t, base, name))
	if err != nil {
		t.Fatalf("OpenStore returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("store.Close() returned error: %v", err)
		}
		cleaner, err := sql.Open("pgx", base)
		if err != nil {
			return
		}
		defer cleaner.Close()
		// Dropping needs the connections above to be gone, which Close ensures.
		if _, err := cleaner.Exec("DROP DATABASE IF EXISTS " + name); err != nil {
			t.Logf("could not drop %s: %v", name, err)
		}
	})
	return store
}

// mustCreatePlayer creates a player and fails the test if that is not possible.
func mustCreatePlayer(t *testing.T, s *Store, name string) *Player {
	t.Helper()

	p, err := s.CreatePlayer(name)
	if err != nil {
		t.Fatalf("CreatePlayer(%q) returned error: %v", name, err)
	}
	if p == nil {
		t.Fatalf("CreatePlayer(%q) returned nil player with nil error", name)
	}
	return p
}

// mustAddScore records a run and fails the test if that is not possible.
func mustAddScore(t *testing.T, s *Store, playerID int64, score, moves, duration int, won bool) *Score {
	t.Helper()

	sc, _, err := s.SubmitScore(playerID, "solitaire", score, moves, duration, won, "medium")
	if err != nil {
		t.Fatalf("AddScore(player=%d, score=%d) returned error: %v", playerID, score, err)
	}
	if sc == nil {
		t.Fatalf("AddScore(player=%d, score=%d) returned nil score with nil error", playerID, score)
	}
	return sc
}

func assertPlayerAggregates(t *testing.T, p *Player, wantBest, wantGames, wantWon int) {
	t.Helper()

	if p.BestScore != wantBest {
		t.Errorf("player %q BestScore = %d, want %d", p.Name, p.BestScore, wantBest)
	}
	if p.Games != wantGames {
		t.Errorf("player %q Games = %d, want %d", p.Name, p.Games, wantGames)
	}
	if p.GamesWon != wantWon {
		t.Errorf("player %q GamesWon = %d, want %d", p.Name, p.GamesWon, wantWon)
	}
}

// ---- NormalizeName -------------------------------------------------------

func TestNormalizeName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "uppercases lowercase handle", input: "ace", want: "ACE"},
		{name: "keeps already uppercase handle", input: "ACE", want: "ACE"},
		{name: "mixed case is uppercased", input: "AcE", want: "ACE"},
		{name: "trims surrounding whitespace", input: "   ace   ", want: "ACE"},
		{name: "collapses inner whitespace", input: "big   red", want: "BIG RED"},
		{name: "collapses tabs and newlines", input: "\tzed\n\n row \t", want: "ZED ROW"},
		{name: "allows digits", input: "player1", want: "PLAYER1"},
		{name: "allows underscore", input: "cool_cat", want: "COOL_CAT"},
		{name: "allows hyphen", input: "cool-cat", want: "COOL-CAT"},
		{name: "allows the full legal alphabet", input: "ab 12 -_", want: "AB 12 -_"},
		{name: "exactly twelve runes is allowed", input: "abcdefghijkl", want: "ABCDEFGHIJKL"},
		{name: "twelve runes including spaces is allowed", input: "aaaa bbb ccc", want: "AAAA BBB CCC"},
		{name: "rejects thirteen runes including spaces", input: "aaaa bbb cccc", wantErr: true},
		{name: "rejects empty string", input: "", wantErr: true},
		{name: "rejects whitespace only", input: "     ", wantErr: true},
		{name: "rejects tabs and newlines only", input: "\t\n ", wantErr: true},
		{name: "rejects thirteen runes", input: "abcdefghijklm", wantErr: true},
		{name: "rejects long handle even after collapsing", input: "  abcdefghijklmnop  ", wantErr: true},
		{name: "rejects exclamation mark", input: "ace!", wantErr: true},
		{name: "rejects period", input: "a.c.e", wantErr: true},
		{name: "rejects at sign", input: "a@b", wantErr: true},
		{name: "rejects hash", input: "#1", wantErr: true},
		{name: "rejects emoji", input: "🔥", wantErr: true},
		{name: "rejects emoji mixed with letters", input: "ace🔥", wantErr: true},
		{name: "rejects accented letters", input: "café", wantErr: true},
		{name: "rejects non-latin script", input: "日本語", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeName(tc.input)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidName) {
					t.Fatalf("NormalizeName(%q) error = %v, want ErrInvalidName", tc.input, err)
				}
				if got != "" {
					t.Errorf("NormalizeName(%q) = %q on error, want empty string", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeName(%q) returned unexpected error: %v", tc.input, err)
			}
			if got != tc.want {
				t.Errorf("NormalizeName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// ---- CreatePlayer --------------------------------------------------------

func TestCreatePlayer(t *testing.T) {
	t.Run("returns a normalized player with zeroed stats", func(t *testing.T) {
		store := newTestStore(t)

		p := mustCreatePlayer(t, store, "  ace  ")
		if p.Name != "ACE" {
			t.Errorf("Name = %q, want %q", p.Name, "ACE")
		}
		if p.ID <= 0 {
			t.Errorf("ID = %d, want a positive row id", p.ID)
		}
		if p.CreatedAt == "" {
			t.Error("CreatedAt = \"\", want a non-empty timestamp")
		}
		assertPlayerAggregates(t, p, 0, 0, 0)
	})

	t.Run("rejects an invalid name", func(t *testing.T) {
		store := newTestStore(t)

		p, err := store.CreatePlayer("nope!")
		if !errors.Is(err, ErrInvalidName) {
			t.Fatalf("CreatePlayer(%q) error = %v, want ErrInvalidName", "nope!", err)
		}
		if p != nil {
			t.Errorf("CreatePlayer(%q) player = %+v, want nil", "nope!", p)
		}
	})

	t.Run("duplicate name returns ErrPlayerExists", func(t *testing.T) {
		store := newTestStore(t)
		mustCreatePlayer(t, store, "ACE")

		duplicates := []string{"ACE", "ace", "AcE", "  ace  "}
		for _, raw := range duplicates {
			p, err := store.CreatePlayer(raw)
			if !errors.Is(err, ErrPlayerExists) {
				t.Errorf("CreatePlayer(%q) error = %v, want ErrPlayerExists", raw, err)
			}
			if p != nil {
				t.Errorf("CreatePlayer(%q) player = %+v, want nil", raw, p)
			}
		}
	})

	t.Run("distinct names both succeed", func(t *testing.T) {
		store := newTestStore(t)

		a := mustCreatePlayer(t, store, "ace")
		b := mustCreatePlayer(t, store, "bee")
		if a.ID == b.ID {
			t.Errorf("ACE and BEE share id %d, want distinct ids", a.ID)
		}
	})
}

func TestGetPlayerByName(t *testing.T) {
	store := newTestStore(t)
	created := mustCreatePlayer(t, store, "ace")

	t.Run("finds a player case-insensitively", func(t *testing.T) {
		got, err := store.GetPlayerByName("ace")
		if err != nil {
			t.Fatalf("GetPlayerByName(%q) returned error: %v", "ace", err)
		}
		if got.ID != created.ID {
			t.Errorf("GetPlayerByName(%q) id = %d, want %d", "ace", got.ID, created.ID)
		}
		if got.Name != "ACE" {
			t.Errorf("GetPlayerByName(%q) name = %q, want %q", "ace", got.Name, "ACE")
		}
	})

	t.Run("unknown name returns ErrPlayerNotFound", func(t *testing.T) {
		if _, err := store.GetPlayerByName("NOBODY"); !errors.Is(err, ErrPlayerNotFound) {
			t.Fatalf("GetPlayerByName(%q) error = %v, want ErrPlayerNotFound", "NOBODY", err)
		}
	})
}

func TestGetPlayerUnknownID(t *testing.T) {
	store := newTestStore(t)

	p, err := store.GetPlayer(4242)
	if !errors.Is(err, ErrPlayerNotFound) {
		t.Fatalf("GetPlayer(4242) error = %v, want ErrPlayerNotFound", err)
	}
	if p != nil {
		t.Errorf("GetPlayer(4242) player = %+v, want nil", p)
	}
}

// ---- AddScore ------------------------------------------------------------

func TestSubmitScore(t *testing.T) {
	t.Run("records a run for a known player", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")

		sc, isBest, err := store.SubmitScore(player.ID, "solitaire", 1250, 90, 240, true, "hard")
		if err != nil {
			t.Fatalf("SubmitScore returned error: %v", err)
		}
		if !isBest {
			t.Error("first run for a game should be a personal best")
		}
		if sc.Score != 1250 || sc.Moves != 90 || sc.Duration != 240 || !sc.Won {
			t.Errorf("stored %+v, want the submitted values", sc)
		}
		if sc.Game != "solitaire" || sc.Difficulty != "hard" || sc.PlayerName != "ACE" {
			t.Errorf("stored %+v, want game=solitaire difficulty=hard name=ACE", sc)
		}
	})

	t.Run("a lower score neither replaces nor is stored", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, player.ID, "solitaire", 5000)

		best, isBest, err := store.SubmitScore(player.ID, "solitaire", 100, 1, 1, false, "easy")
		if err != nil {
			t.Fatalf("SubmitScore returned error: %v", err)
		}
		if isBest {
			t.Error("100 should not beat 5000")
		}
		if best.Score != 5000 {
			t.Errorf("returned best = %d, want the surviving 5000", best.Score)
		}

		// The weaker run must leave no trace at all.
		rows, err := store.PlayerScores(player.ID, 50)
		if err != nil {
			t.Fatalf("PlayerScores: %v", err)
		}
		if len(rows) != 1 {
			t.Fatalf("len(rows) = %d, want exactly 1 (bests only, no history)", len(rows))
		}
		if rows[0].Score != 5000 {
			t.Errorf("kept score = %d, want 5000", rows[0].Score)
		}
	})

	t.Run("an equal score does not replace", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, player.ID, "solitaire", 900)

		_, isBest, err := store.SubmitScore(player.ID, "solitaire", 900, 1, 1, false, "easy")
		if err != nil {
			t.Fatalf("SubmitScore returned error: %v", err)
		}
		if isBest {
			t.Error("an equal score should not count as a new best")
		}
	})

	t.Run("a higher score replaces the stored best", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, player.ID, "solitaire", 900)

		best, isBest, err := store.SubmitScore(player.ID, "solitaire", 4200, 120, 300, true, "hard")
		if err != nil {
			t.Fatalf("SubmitScore returned error: %v", err)
		}
		if !isBest {
			t.Error("4200 should beat 900")
		}
		if best.Score != 4200 || best.Difficulty != "hard" || !best.Won {
			t.Errorf("stored %+v, want the new run's values", best)
		}

		rows, _ := store.PlayerScores(player.ID, 50)
		if len(rows) != 1 {
			t.Errorf("len(rows) = %d, want 1 row still", len(rows))
		}
	})

	t.Run("each game keeps its own best", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, player.ID, "solitaire", 3000)
		mustSubmit(t, store, player.ID, "sudoku", 1500)

		rows, err := store.PlayerScores(player.ID, 50)
		if err != nil {
			t.Fatalf("PlayerScores: %v", err)
		}
		if len(rows) != 2 {
			t.Fatalf("len(rows) = %d, want one per game", len(rows))
		}
		// A weaker sudoku run must not disturb the solitaire best.
		store.SubmitScore(player.ID, "sudoku", 10, 1, 1, false, "easy")
		got, err := store.BestScore(player.ID, "solitaire")
		if err != nil {
			t.Fatalf("BestScore: %v", err)
		}
		if got.Score != 3000 {
			t.Errorf("solitaire best = %d, want 3000", got.Score)
		}
	})

	t.Run("an unknown game falls back to solitaire", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")
		sc, _, err := store.SubmitScore(player.ID, "pinball", 10, 1, 1, false, "easy")
		if err != nil {
			t.Fatalf("SubmitScore: %v", err)
		}
		if sc.Game != "solitaire" {
			t.Errorf("game = %q, want solitaire", sc.Game)
		}
	})

	t.Run("unknown player id returns ErrPlayerNotFound", func(t *testing.T) {
		store := newTestStore(t)
		mustCreatePlayer(t, store, "ace")

		for _, id := range []int64{0, -1, 9999} {
			sc, _, err := store.SubmitScore(id, "solitaire", 100, 10, 10, false, "medium")
			if !errors.Is(err, ErrPlayerNotFound) {
				t.Errorf("SubmitScore(playerID=%d) error = %v, want ErrPlayerNotFound", id, err)
			}
			if sc != nil {
				t.Errorf("SubmitScore(playerID=%d) score = %+v, want nil", id, sc)
			}
		}
	})
}

// mustSubmit records a score and fails the test if it errors.
func mustSubmit(t *testing.T, s *Store, playerID int64, game string, score int) *Score {
	t.Helper()
	sc, _, err := s.SubmitScore(playerID, game, score, 10, 100, true, "medium")
	if err != nil {
		t.Fatalf("SubmitScore(player=%d, game=%s, score=%d): %v", playerID, game, score, err)
	}
	return sc
}

func TestPlayerScores(t *testing.T) {
	store := newTestStore(t)
	ace := mustCreatePlayer(t, store, "ace")
	zed := mustCreatePlayer(t, store, "zed")
	mustSubmit(t, store, ace.ID, "solitaire", 900)
	mustSubmit(t, store, ace.ID, "sudoku", 2500)
	mustSubmit(t, store, zed.ID, "solitaire", 4000)

	t.Run("returns only that player's bests, highest first", func(t *testing.T) {
		rows, err := store.PlayerScores(ace.ID, 10)
		if err != nil {
			t.Fatalf("PlayerScores: %v", err)
		}
		if len(rows) != 2 {
			t.Fatalf("len(rows) = %d, want 2", len(rows))
		}
		if rows[0].Score != 2500 || rows[1].Score != 900 {
			t.Errorf("scores = %d, %d, want 2500 then 900", rows[0].Score, rows[1].Score)
		}
		for _, r := range rows {
			if r.PlayerID != ace.ID {
				t.Errorf("leaked another player's row: %+v", r)
			}
		}
	})

	t.Run("unknown player returns an empty slice", func(t *testing.T) {
		rows, err := store.PlayerScores(9999, 10)
		if err != nil {
			t.Fatalf("PlayerScores: %v", err)
		}
		if len(rows) != 0 {
			t.Errorf("len(rows) = %d, want 0", len(rows))
		}
	})
}

func seedLeaderboard(t *testing.T, store *Store) (ace, bee, cee *Player) {
	t.Helper()

	ace = mustCreatePlayer(t, store, "ace")
	bee = mustCreatePlayer(t, store, "bee")
	cee = mustCreatePlayer(t, store, "cee")

	mustAddScore(t, store, ace.ID, 900, 120, 100, true) // ties with BEE's 900, slower
	mustAddScore(t, store, ace.ID, 500, 80, 60, true)
	mustAddScore(t, store, ace.ID, 300, 40, 30, false)
	mustAddScore(t, store, bee.ID, 900, 110, 50, true) // ties with ACE's 900, faster
	mustAddScore(t, store, bee.ID, 700, 90, 80, false)
	mustAddScore(t, store, bee.ID, 100, 20, 20, false)
	mustAddScore(t, store, cee.ID, 800, 100, 70, true)
	mustAddScore(t, store, cee.ID, 400, 50, 45, false)

	return ace, bee, cee
}

func TestLeaderboard(t *testing.T) {
	t.Run("ranks players by their combined total across games", func(t *testing.T) {
		store := newTestStore(t)

		// ACE wins on the combined total despite a lower solitaire best.
		ace := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, ace.ID, "solitaire", 3000)
		mustSubmit(t, store, ace.ID, "sudoku", 2500)

		zed := mustCreatePlayer(t, store, "zed")
		mustSubmit(t, store, zed.ID, "solitaire", 4000)

		nova := mustCreatePlayer(t, store, "nova")
		mustSubmit(t, store, nova.ID, "sudoku", 1000)

		entries, err := store.Leaderboard(5)
		if err != nil {
			t.Fatalf("Leaderboard: %v", err)
		}
		if len(entries) != 3 {
			t.Fatalf("len(entries) = %d, want 3 (one row per player)", len(entries))
		}

		want := []struct {
			name  string
			total int
		}{{"ACE", 5500}, {"ZED", 4000}, {"NOVA", 1000}}
		for i, w := range want {
			if entries[i].PlayerName != w.name || entries[i].TotalScore != w.total {
				t.Errorf("rank %d = %s/%d, want %s/%d",
					i+1, entries[i].PlayerName, entries[i].TotalScore, w.name, w.total)
			}
			if entries[i].Rank != i+1 {
				t.Errorf("entry %d rank = %d, want %d", i, entries[i].Rank, i+1)
			}
		}
	})

	t.Run("reports the per-game breakdown", func(t *testing.T) {
		store := newTestStore(t)
		ace := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, ace.ID, "solitaire", 3000)
		mustSubmit(t, store, ace.ID, "sudoku", 2500)

		entries, err := store.Leaderboard(5)
		if err != nil {
			t.Fatalf("Leaderboard: %v", err)
		}
		got := entries[0].Bests
		if got["solitaire"] != 3000 || got["sudoku"] != 2500 {
			t.Errorf("bests = %v, want solitaire=3000 sudoku=2500", got)
		}
		if entries[0].Games != 2 {
			t.Errorf("games_played = %d, want 2", entries[0].Games)
		}
	})

	t.Run("a player appears once no matter how many runs", func(t *testing.T) {
		store := newTestStore(t)
		ace := mustCreatePlayer(t, store, "ace")
		for _, score := range []int{100, 900, 400, 2000, 50} {
			store.SubmitScore(ace.ID, "solitaire", score, 1, 1, false, "easy")
		}

		entries, err := store.Leaderboard(10)
		if err != nil {
			t.Fatalf("Leaderboard: %v", err)
		}
		if len(entries) != 1 {
			t.Fatalf("len(entries) = %d, want 1", len(entries))
		}
		if entries[0].TotalScore != 2000 {
			t.Errorf("total = %d, want only the best run (2000)", entries[0].TotalScore)
		}
	})

	t.Run("players with no score are left off", func(t *testing.T) {
		store := newTestStore(t)
		mustCreatePlayer(t, store, "ghost")
		ace := mustCreatePlayer(t, store, "ace")
		mustSubmit(t, store, ace.ID, "solitaire", 10)

		entries, err := store.Leaderboard(10)
		if err != nil {
			t.Fatalf("Leaderboard: %v", err)
		}
		if len(entries) != 1 || entries[0].PlayerName != "ACE" {
			t.Errorf("entries = %+v, want only ACE", entries)
		}
	})

	t.Run("limit is honoured and defaults on nonsense", func(t *testing.T) {
		store := newTestStore(t)
		for i, name := range []string{"AAA", "BBB", "CCC", "DDD", "EEE", "FFF"} {
			p := mustCreatePlayer(t, store, name)
			mustSubmit(t, store, p.ID, "solitaire", (i+1)*100)
		}
		if got, _ := store.Leaderboard(2); len(got) != 2 {
			t.Errorf("limit 2 returned %d rows", len(got))
		}
		if got, _ := store.Leaderboard(0); len(got) != 5 {
			t.Errorf("limit 0 returned %d rows, want the default 5", len(got))
		}
		if got, _ := store.Leaderboard(-3); len(got) != 5 {
			t.Errorf("negative limit returned %d rows, want the default 5", len(got))
		}
	})
}

func TestLeaderboardEmpty(t *testing.T) {
	store := newTestStore(t)

	got, err := store.Leaderboard(0)
	if err != nil {
		t.Fatalf("Leaderboard(0) returned error: %v", err)
	}
	if got == nil {
		t.Fatal("Leaderboard(0) = nil, want an empty non-nil slice")
	}
	if len(got) != 0 {
		t.Errorf("Leaderboard(0) returned %d entries, want 0", len(got))
	}
}

// ---- aggregate columns ---------------------------------------------------

func TestPlayerAggregateColumns(t *testing.T) {
	store := newTestStore(t)
	ace := mustCreatePlayer(t, store, "ace")
	mustSubmit(t, store, ace.ID, "solitaire", 3000)
	mustSubmit(t, store, ace.ID, "sudoku", 2500)
	// A losing run that is still a personal best for that game.
	store.SubmitScore(ace.ID, "sudoku", 4000, 1, 1, false, "easy")
	ghost := mustCreatePlayer(t, store, "ghost")

	t.Run("total is the sum of per-game bests", func(t *testing.T) {
		got, err := store.GetPlayer(ace.ID)
		if err != nil {
			t.Fatalf("GetPlayer: %v", err)
		}
		if got.TotalScore != 7000 {
			t.Errorf("total_score = %d, want 3000 + 4000", got.TotalScore)
		}
		if got.BestScore != 4000 {
			t.Errorf("best_score = %d, want the single highest 4000", got.BestScore)
		}
		if got.Games != 2 {
			t.Errorf("games_played = %d, want 2 games with a best", got.Games)
		}
		if got.Bests["solitaire"] != 3000 || got.Bests["sudoku"] != 4000 {
			t.Errorf("bests = %v", got.Bests)
		}
	})

	t.Run("a player with no scores reports zeroes, not an error", func(t *testing.T) {
		got, err := store.GetPlayer(ghost.ID)
		if err != nil {
			t.Fatalf("GetPlayer: %v", err)
		}
		if got.TotalScore != 0 || got.BestScore != 0 || got.Games != 0 || got.GamesWon != 0 {
			t.Errorf("unplayed player = %+v, want zeroed stats", got)
		}
		if got.Bests == nil {
			t.Error("bests should be an empty map, not nil")
		}
	})

	t.Run("ListPlayers orders by total", func(t *testing.T) {
		players, err := store.ListPlayers()
		if err != nil {
			t.Fatalf("ListPlayers: %v", err)
		}
		if len(players) != 2 || players[0].Name != "ACE" {
			t.Fatalf("players = %+v, want ACE first", players)
		}
		if players[0].TotalScore != 7000 {
			t.Errorf("ACE total = %d, want 7000", players[0].TotalScore)
		}
	})
}

func TestListPlayersEmpty(t *testing.T) {
	store := newTestStore(t)

	got, err := store.ListPlayers()
	if err != nil {
		t.Fatalf("ListPlayers() returned error: %v", err)
	}
	if got == nil {
		t.Fatal("ListPlayers() = nil, want an empty non-nil slice")
	}
	if len(got) != 0 {
		t.Errorf("ListPlayers() returned %d players, want 0", len(got))
	}
}
