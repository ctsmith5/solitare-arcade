package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func newTestAPI(t *testing.T) *API {
	t.Helper()
	return &API{store: newTestStore(t)}
}

// do issues a request against the router and returns the recorder.
func do(t *testing.T, api *API, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, req)
	return rec
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, want, rec.Body.String())
	}
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return out
}

/* ---- players ---------------------------------------------------------- */

func TestCreatePlayerEndpoint(t *testing.T) {
	api := newTestAPI(t)

	t.Run("valid name is normalized and created", func(t *testing.T) {
		rec := do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "  ace  runner "})
		assertStatus(t, rec, http.StatusCreated)

		player := decodeBody[Player](t, rec)
		if player.Name != "ACE RUNNER" {
			t.Errorf("name = %q, want %q", player.Name, "ACE RUNNER")
		}
		if player.ID <= 0 {
			t.Errorf("id = %d, want positive", player.ID)
		}
		if player.BestScore != 0 || player.Games != 0 || player.GamesWon != 0 {
			t.Errorf("new player should have zeroed stats, got %+v", player)
		}
	})

	t.Run("invalid name is rejected", func(t *testing.T) {
		for _, name := range []string{"", "   ", "way too long a name", "bad!chars", "emoji🎮"} {
			rec := do(t, api, http.MethodPost, "/api/players", map[string]string{"name": name})
			assertStatus(t, rec, http.StatusBadRequest)
		}
	})

	t.Run("existing name selects that player instead of erroring", func(t *testing.T) {
		first := do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "ZED"})
		assertStatus(t, first, http.StatusCreated)
		created := decodeBody[Player](t, first)

		// No passwords on this cabinet, so re-entering a handle just selects it.
		again := do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "zed"})
		assertStatus(t, again, http.StatusOK)
		existing := decodeBody[Player](t, again)

		if existing.ID != created.ID {
			t.Errorf("id = %d, want the existing %d", existing.ID, created.ID)
		}
	})

	t.Run("malformed body is rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/players", bytes.NewReader([]byte("{oops")))
		rec := httptest.NewRecorder()
		api.Routes().ServeHTTP(rec, req)
		assertStatus(t, rec, http.StatusBadRequest)
	})
}

func TestListPlayersEndpoint(t *testing.T) {
	api := newTestAPI(t)

	rec := do(t, api, http.MethodGet, "/api/players", nil)
	assertStatus(t, rec, http.StatusOK)
	if got := rec.Body.String(); got != "[]\n" {
		t.Errorf("empty list = %q, want an empty JSON array (not null)", got)
	}

	do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "NOVA"})
	rec = do(t, api, http.MethodGet, "/api/players", nil)
	assertStatus(t, rec, http.StatusOK)
	if players := decodeBody[[]Player](t, rec); len(players) != 1 {
		t.Errorf("len(players) = %d, want 1", len(players))
	}
}

func TestGetPlayerEndpoint(t *testing.T) {
	api := newTestAPI(t)
	created := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "PIXEL"}))

	assertStatus(t, do(t, api, http.MethodGet, "/api/players/abc", nil), http.StatusBadRequest)
	assertStatus(t, do(t, api, http.MethodGet, "/api/players/0", nil), http.StatusBadRequest)
	assertStatus(t, do(t, api, http.MethodGet, "/api/players/99999", nil), http.StatusNotFound)

	rec := do(t, api, http.MethodGet, "/api/players/1", nil)
	assertStatus(t, rec, http.StatusOK)
	if got := decodeBody[Player](t, rec); got.ID != created.ID {
		t.Errorf("id = %d, want %d", got.ID, created.ID)
	}
}

/* ---- scores ----------------------------------------------------------- */

type scoreBody struct {
	PlayerID int64 `json:"player_id"`
	Score    int   `json:"score"`
	Moves    int   `json:"moves"`
	Duration int   `json:"duration_seconds"`
	Won      bool  `json:"won"`
}

func TestCreateScoreEndpoint(t *testing.T) {
	api := newTestAPI(t)
	player := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "RETRO"}))

	t.Run("happy path", func(t *testing.T) {
		rec := do(t, api, http.MethodPost, "/api/scores", scoreBody{
			PlayerID: player.ID, Score: 1250, Moves: 90, Duration: 240, Won: true,
		})
		assertStatus(t, rec, http.StatusCreated)

		saved := decodeBody[Score](t, rec)
		if saved.Score != 1250 || !saved.Won || saved.PlayerName != "RETRO" {
			t.Errorf("unexpected saved score: %+v", saved)
		}
	})

	t.Run("rejects bad input", func(t *testing.T) {
		cases := map[string]struct {
			body scoreBody
			want int
		}{
			"missing player":  {scoreBody{Score: 10}, http.StatusBadRequest},
			"negative score":  {scoreBody{PlayerID: player.ID, Score: -1}, http.StatusBadRequest},
			"negative moves":  {scoreBody{PlayerID: player.ID, Moves: -5}, http.StatusBadRequest},
			"unknown player":  {scoreBody{PlayerID: 4242, Score: 10}, http.StatusNotFound},
			"negative length": {scoreBody{PlayerID: player.ID, Duration: -3}, http.StatusBadRequest},
		}
		for name, tc := range cases {
			t.Run(name, func(t *testing.T) {
				assertStatus(t, do(t, api, http.MethodPost, "/api/scores", tc.body), tc.want)
			})
		}
	})
}

/* ---- leaderboard ------------------------------------------------------ */

func TestLeaderboardEndpoint(t *testing.T) {
	api := newTestAPI(t)

	rec := do(t, api, http.MethodGet, "/api/leaderboard", nil)
	assertStatus(t, rec, http.StatusOK)
	if got := rec.Body.String(); got != "[]\n" {
		t.Errorf("empty leaderboard = %q, want an empty JSON array (not null)", got)
	}

	names := []string{"AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG"}
	scores := []int{500, 4000, 1500, 900, 2500, 120, 3300}
	for i, name := range names {
		p := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": name}))
		do(t, api, http.MethodPost, "/api/scores", scoreBody{
			PlayerID: p.ID, Score: scores[i], Moves: 10, Duration: 100, Won: i%2 == 0,
		})
	}

	t.Run("defaults to the top 5, ranked", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard", nil)
		assertStatus(t, rec, http.StatusOK)
		entries := decodeBody[[]LeaderboardEntry](t, rec)

		if len(entries) != 5 {
			t.Fatalf("len = %d, want 5", len(entries))
		}
		want := []int{4000, 3300, 2500, 1500, 900}
		for i, entry := range entries {
			if entry.Score != want[i] {
				t.Errorf("entry %d score = %d, want %d", i, entry.Score, want[i])
			}
			if entry.Rank != i+1 {
				t.Errorf("entry %d rank = %d, want %d", i, entry.Rank, i+1)
			}
		}
	})

	t.Run("respects limit", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard?limit=2", nil)
		assertStatus(t, rec, http.StatusOK)
		if entries := decodeBody[[]LeaderboardEntry](t, rec); len(entries) != 2 {
			t.Errorf("len = %d, want 2", len(entries))
		}
	})

	t.Run("falls back to the default on a nonsense limit", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard?limit=abc", nil)
		assertStatus(t, rec, http.StatusOK)
		if entries := decodeBody[[]LeaderboardEntry](t, rec); len(entries) != 5 {
			t.Errorf("len = %d, want the default 5", len(entries))
		}
	})
}

/* ---- difficulty ------------------------------------------------------- */

func TestScoreDifficulty(t *testing.T) {
	api := newTestAPI(t)
	player := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "DIFF"}))

	t.Run("round-trips each difficulty", func(t *testing.T) {
		for _, want := range []string{"easy", "medium", "hard"} {
			rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
				"player_id": player.ID, "score": 100, "moves": 5,
				"duration_seconds": 60, "won": true, "difficulty": want,
			})
			assertStatus(t, rec, http.StatusCreated)
			if got := decodeBody[Score](t, rec).Difficulty; got != want {
				t.Errorf("difficulty = %q, want %q", got, want)
			}
		}
	})

	t.Run("unknown and missing values fall back to medium", func(t *testing.T) {
		for _, given := range []string{"", "IMPOSSIBLE", "  HARDER  "} {
			rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
				"player_id": player.ID, "score": 10, "difficulty": given,
			})
			assertStatus(t, rec, http.StatusCreated)
			if got := decodeBody[Score](t, rec).Difficulty; got != "medium" {
				t.Errorf("difficulty for %q = %q, want medium", given, got)
			}
		}
	})

	t.Run("casing is normalized", func(t *testing.T) {
		rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
			"player_id": player.ID, "score": 10, "difficulty": "HARD",
		})
		assertStatus(t, rec, http.StatusCreated)
		if got := decodeBody[Score](t, rec).Difficulty; got != "hard" {
			t.Errorf("difficulty = %q, want hard", got)
		}
	})

	t.Run("leaderboard reports it", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard", nil)
		assertStatus(t, rec, http.StatusOK)
		entries := decodeBody[[]LeaderboardEntry](t, rec)
		if len(entries) == 0 {
			t.Fatal("expected at least one entry")
		}
		for _, e := range entries {
			if !validDifficulties[e.Difficulty] {
				t.Errorf("entry %+v has an unexpected difficulty", e)
			}
		}
	})
}

// A database written before the difficulty column existed must still open, and
// its existing rows should read back as medium.
func TestMigratesLegacyDatabase(t *testing.T) {
	base := testBaseURL(t)
	name := fmt.Sprintf("solitaire_legacy_%d_%d", os.Getpid(), testDBSeq.Add(1))

	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer admin.Close()
	if _, err := admin.Exec("DROP DATABASE IF EXISTS " + name); err != nil {
		t.Fatalf("drop stale: %v", err)
	}
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		cleaner, err := sql.Open("pgx", base)
		if err != nil {
			return
		}
		defer cleaner.Close()
		cleaner.Exec("DROP DATABASE IF EXISTS " + name)
	})

	dsn := onDatabase(t, base, name)
	legacy, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	// The original schema: no difficulty column.
	_, err = legacy.Exec(`
CREATE TABLE players (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE scores (
    id BIGSERIAL PRIMARY KEY,
    player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    moves INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    won BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO players (name) VALUES ('OLDTIMER');
INSERT INTO scores (player_id, score, moves, duration_seconds, won)
VALUES (1, 4200, 120, 300, TRUE);`)
	if err != nil {
		t.Fatalf("seed legacy schema: %v", err)
	}
	legacy.Close()

	store, err := OpenStore(dsn)
	if err != nil {
		t.Fatalf("OpenStore on a legacy database: %v", err)
	}

	entries, err := store.Leaderboard(5)
	if err != nil {
		t.Fatalf("Leaderboard: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("len(entries) = %d, want 1", len(entries))
	}
	if entries[0].Difficulty != "medium" {
		t.Errorf("legacy row difficulty = %q, want medium", entries[0].Difficulty)
	}
	if entries[0].Score != 4200 {
		t.Errorf("legacy score = %d, want 4200", entries[0].Score)
	}
	store.Close()

	// Opening again must be a no-op rather than a duplicate-column error.
	again, err := OpenStore(dsn)
	if err != nil {
		t.Fatalf("second OpenStore: %v", err)
	}
	again.Close()
}

/* ---- middleware ------------------------------------------------------- */

func TestCORSPreflight(t *testing.T) {
	api := newTestAPI(t)
	req := httptest.NewRequest(http.MethodOptions, "/api/players", nil)
	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, req)

	assertStatus(t, rec, http.StatusNoContent)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
	}
}

func TestHealth(t *testing.T) {
	api := newTestAPI(t)
	rec := do(t, api, http.MethodGet, "/api/health", nil)
	assertStatus(t, rec, http.StatusOK)
	if body := decodeBody[map[string]string](t, rec); body["status"] != "ok" {
		t.Errorf("status = %q, want ok", body["status"])
	}
}
