package main

import (
	"errors"
	"path/filepath"
	"testing"
)

// newTestStore opens a Store backed by a brand new SQLite file inside the
// test's own temp dir, so every test (and subtest) gets an isolated database.
func newTestStore(t *testing.T) *Store {
	t.Helper()

	path := filepath.Join(t.TempDir(), "arcade_test.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore(%q) returned error: %v", path, err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("store.Close() returned error: %v", err)
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

	sc, err := s.AddScore(playerID, score, moves, duration, won, "medium")
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

func TestAddScore(t *testing.T) {
	t.Run("records a run for a known player", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")

		got := mustAddScore(t, store, player.ID, 1200, 140, 95, true)
		if got.ID <= 0 {
			t.Errorf("Score.ID = %d, want a positive row id", got.ID)
		}
		if got.PlayerID != player.ID {
			t.Errorf("Score.PlayerID = %d, want %d", got.PlayerID, player.ID)
		}
		if got.PlayerName != "ACE" {
			t.Errorf("Score.PlayerName = %q, want %q", got.PlayerName, "ACE")
		}
		if got.Score != 1200 {
			t.Errorf("Score.Score = %d, want %d", got.Score, 1200)
		}
		if got.Moves != 140 {
			t.Errorf("Score.Moves = %d, want %d", got.Moves, 140)
		}
		if got.Duration != 95 {
			t.Errorf("Score.Duration = %d, want %d", got.Duration, 95)
		}
		if !got.Won {
			t.Errorf("Score.Won = %v, want %v", got.Won, true)
		}
		if got.CreatedAt == "" {
			t.Error("Score.CreatedAt = \"\", want a non-empty timestamp")
		}
	})

	t.Run("records a lost run", func(t *testing.T) {
		store := newTestStore(t)
		player := mustCreatePlayer(t, store, "ace")

		got := mustAddScore(t, store, player.ID, 10, 3, 2, false)
		if got.Won {
			t.Errorf("Score.Won = %v, want %v", got.Won, false)
		}
	})

	t.Run("unknown player id returns ErrPlayerNotFound", func(t *testing.T) {
		store := newTestStore(t)
		mustCreatePlayer(t, store, "ace") // make sure the table is not simply empty

		for _, id := range []int64{0, -1, 9999} {
			sc, err := store.AddScore(id, 100, 10, 10, false, "medium")
			if !errors.Is(err, ErrPlayerNotFound) {
				t.Errorf("AddScore(playerID=%d) error = %v, want ErrPlayerNotFound", id, err)
			}
			if sc != nil {
				t.Errorf("AddScore(playerID=%d) score = %+v, want nil", id, sc)
			}
		}
	})
}

func TestPlayerScores(t *testing.T) {
	store := newTestStore(t)
	ace := mustCreatePlayer(t, store, "ace")
	bee := mustCreatePlayer(t, store, "bee")

	mustAddScore(t, store, ace.ID, 300, 30, 30, false)
	mustAddScore(t, store, ace.ID, 900, 90, 90, true)
	mustAddScore(t, store, ace.ID, 600, 60, 60, false)
	mustAddScore(t, store, bee.ID, 1500, 10, 10, true)

	t.Run("returns only that player's runs, best first", func(t *testing.T) {
		got, err := store.PlayerScores(ace.ID, 0)
		if err != nil {
			t.Fatalf("PlayerScores(%d, 0) returned error: %v", ace.ID, err)
		}
		want := []int{900, 600, 300}
		if len(got) != len(want) {
			t.Fatalf("PlayerScores(%d, 0) returned %d rows, want %d (%+v)", ace.ID, len(got), len(want), got)
		}
		for i, w := range want {
			if got[i].Score != w {
				t.Errorf("PlayerScores[%d].Score = %d, want %d", i, got[i].Score, w)
			}
			if got[i].PlayerID != ace.ID {
				t.Errorf("PlayerScores[%d].PlayerID = %d, want %d", i, got[i].PlayerID, ace.ID)
			}
		}
	})

	t.Run("honours the limit", func(t *testing.T) {
		got, err := store.PlayerScores(ace.ID, 2)
		if err != nil {
			t.Fatalf("PlayerScores(%d, 2) returned error: %v", ace.ID, err)
		}
		if len(got) != 2 {
			t.Fatalf("PlayerScores(%d, 2) returned %d rows, want 2", ace.ID, len(got))
		}
	})

	t.Run("unknown player returns an empty slice", func(t *testing.T) {
		got, err := store.PlayerScores(9999, 10)
		if err != nil {
			t.Fatalf("PlayerScores(9999, 10) returned error: %v", err)
		}
		if got == nil {
			t.Fatal("PlayerScores(9999, 10) = nil, want an empty non-nil slice")
		}
		if len(got) != 0 {
			t.Errorf("PlayerScores(9999, 10) returned %d rows, want 0", len(got))
		}
	})
}

// ---- Leaderboard ---------------------------------------------------------

// seedLeaderboard inserts eight runs across three players. Every (score,
// duration) pair is unique so the expected ordering never depends on
// created_at, which only has one-second resolution.
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
	store := newTestStore(t)
	ace, bee, cee := seedLeaderboard(t, store)

	type want struct {
		score    int
		duration int
		player   int64
	}
	top5 := []want{
		{score: 900, duration: 50, player: bee.ID}, // tie broken by shorter duration
		{score: 900, duration: 100, player: ace.ID},
		{score: 800, duration: 70, player: cee.ID},
		{score: 700, duration: 80, player: bee.ID},
		{score: 500, duration: 60, player: ace.ID},
	}

	t.Run("defaults to five rows sorted by score desc", func(t *testing.T) {
		got, err := store.Leaderboard(0)
		if err != nil {
			t.Fatalf("Leaderboard(0) returned error: %v", err)
		}
		if len(got) != 5 {
			t.Fatalf("Leaderboard(0) returned %d entries, want 5 (%+v)", len(got), got)
		}
		for i, w := range top5 {
			if got[i].Score != w.score {
				t.Errorf("entry %d: Score = %d, want %d", i, got[i].Score, w.score)
			}
			if got[i].Duration != w.duration {
				t.Errorf("entry %d: Duration = %d, want %d", i, got[i].Duration, w.duration)
			}
			if got[i].PlayerID != w.player {
				t.Errorf("entry %d: PlayerID = %d, want %d", i, got[i].PlayerID, w.player)
			}
			if got[i].Rank != i+1 {
				t.Errorf("entry %d: Rank = %d, want %d", i, got[i].Rank, i+1)
			}
		}
		// Scores must be non-increasing across the whole board.
		for i := 1; i < len(got); i++ {
			if got[i-1].Score < got[i].Score {
				t.Errorf("entry %d score %d < entry %d score %d, want descending order",
					i-1, got[i-1].Score, i, got[i].Score)
			}
		}
	})

	t.Run("negative limit also defaults to five", func(t *testing.T) {
		got, err := store.Leaderboard(-3)
		if err != nil {
			t.Fatalf("Leaderboard(-3) returned error: %v", err)
		}
		if len(got) != 5 {
			t.Errorf("Leaderboard(-3) returned %d entries, want 5", len(got))
		}
	})

	t.Run("ties break by shorter duration first", func(t *testing.T) {
		got, err := store.Leaderboard(2)
		if err != nil {
			t.Fatalf("Leaderboard(2) returned error: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("Leaderboard(2) returned %d entries, want 2", len(got))
		}
		if got[0].Score != got[1].Score {
			t.Fatalf("expected the top two entries to be tied on score, got %d and %d",
				got[0].Score, got[1].Score)
		}
		if got[0].Duration > got[1].Duration {
			t.Errorf("tie ordering: entry 0 duration = %d, entry 1 duration = %d, want the shorter run first",
				got[0].Duration, got[1].Duration)
		}
		if got[0].PlayerName != "BEE" {
			t.Errorf("tie winner = %q, want %q (same score, shorter duration)", got[0].PlayerName, "BEE")
		}
		if got[1].PlayerName != "ACE" {
			t.Errorf("tie runner-up = %q, want %q", got[1].PlayerName, "ACE")
		}
	})

	t.Run("larger limit returns every run", func(t *testing.T) {
		got, err := store.Leaderboard(50)
		if err != nil {
			t.Fatalf("Leaderboard(50) returned error: %v", err)
		}
		if len(got) != 8 {
			t.Fatalf("Leaderboard(50) returned %d entries, want 8", len(got))
		}
		for i := range got {
			if got[i].Rank != i+1 {
				t.Errorf("entry %d: Rank = %d, want %d", i, got[i].Rank, i+1)
			}
		}
	})

	t.Run("won flag round-trips", func(t *testing.T) {
		got, err := store.Leaderboard(1)
		if err != nil {
			t.Fatalf("Leaderboard(1) returned error: %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("Leaderboard(1) returned %d entries, want 1", len(got))
		}
		if !got[0].Won {
			t.Errorf("top entry Won = %v, want %v", got[0].Won, true)
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
	bee := mustCreatePlayer(t, store, "bee")
	zip := mustCreatePlayer(t, store, "zip") // never plays a game

	// ACE: 3 runs, 2 of them won, best score 900.
	mustAddScore(t, store, ace.ID, 900, 90, 90, true)
	mustAddScore(t, store, ace.ID, 500, 50, 50, true)
	mustAddScore(t, store, ace.ID, 300, 30, 30, false)
	// BEE: 2 runs, none won, best score 700.
	mustAddScore(t, store, bee.ID, 700, 70, 70, false)
	mustAddScore(t, store, bee.ID, 200, 20, 20, false)

	t.Run("GetPlayer aggregates", func(t *testing.T) {
		got, err := store.GetPlayer(ace.ID)
		if err != nil {
			t.Fatalf("GetPlayer(%d) returned error: %v", ace.ID, err)
		}
		assertPlayerAggregates(t, got, 900, 3, 2)
	})

	t.Run("GetPlayer with no scores reports zeroes", func(t *testing.T) {
		got, err := store.GetPlayer(zip.ID)
		if err != nil {
			t.Fatalf("GetPlayer(%d) returned error: %v", zip.ID, err)
		}
		if got.Name != "ZIP" {
			t.Errorf("Name = %q, want %q", got.Name, "ZIP")
		}
		assertPlayerAggregates(t, got, 0, 0, 0)
	})

	t.Run("ListPlayers aggregates", func(t *testing.T) {
		players, err := store.ListPlayers()
		if err != nil {
			t.Fatalf("ListPlayers() returned error: %v", err)
		}
		if len(players) != 3 {
			t.Fatalf("ListPlayers() returned %d players, want 3 (%+v)", len(players), players)
		}

		byName := map[string]Player{}
		for _, p := range players {
			byName[p.Name] = p
		}
		for _, tc := range []struct {
			name                        string
			wantBest, wantGames, wantWon int
		}{
			{"ACE", 900, 3, 2},
			{"BEE", 700, 2, 0},
			{"ZIP", 0, 0, 0},
		} {
			p, ok := byName[tc.name]
			if !ok {
				t.Errorf("ListPlayers() is missing player %q", tc.name)
				continue
			}
			assertPlayerAggregates(t, &p, tc.wantBest, tc.wantGames, tc.wantWon)
		}

		// ORDER BY best_score DESC: ACE (900), BEE (700), ZIP (0).
		wantOrder := []string{"ACE", "BEE", "ZIP"}
		for i, want := range wantOrder {
			if players[i].Name != want {
				t.Errorf("ListPlayers()[%d].Name = %q, want %q", i, players[i].Name, want)
			}
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
