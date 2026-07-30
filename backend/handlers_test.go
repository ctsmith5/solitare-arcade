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
	PlayerID int64  `json:"player_id"`
	Game     string `json:"game"`
	Score    int    `json:"score"`
	Moves    int    `json:"moves"`
	Duration int    `json:"duration_seconds"`
	Won      bool   `json:"won"`
}

// submitResult mirrors what POST /api/scores returns.
type submitResult struct {
	PersonalBest bool  `json:"personal_best"`
	Submitted    int   `json:"submitted"`
	Best         Score `json:"best"`
}

// submit posts a run and returns the decoded result.
func submit(t *testing.T, api *API, playerID int64, game string, score int) submitResult {
	t.Helper()
	rec := do(t, api, http.MethodPost, "/api/scores", scoreBody{
		PlayerID: playerID, Game: game, Score: score, Moves: 10, Duration: 100, Won: true,
	})
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("submit %d: status %d (%s)", score, rec.Code, rec.Body.String())
	}
	return decodeBody[submitResult](t, rec)
}

func TestCreateScoreEndpoint(t *testing.T) {
	api := newTestAPI(t)
	player := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "RETRO"}))

	t.Run("first run is a personal best and returns 201", func(t *testing.T) {
		rec := do(t, api, http.MethodPost, "/api/scores", scoreBody{
			PlayerID: player.ID, Game: "solitaire", Score: 1250, Moves: 90, Duration: 240, Won: true,
		})
		assertStatus(t, rec, http.StatusCreated)

		got := decodeBody[submitResult](t, rec)
		if !got.PersonalBest {
			t.Error("personal_best = false, want true for a first run")
		}
		if got.Best.Score != 1250 || got.Best.PlayerName != "RETRO" || got.Best.Game != "solitaire" {
			t.Errorf("unexpected stored best: %+v", got.Best)
		}
	})

	t.Run("a weaker run returns 200 and keeps the old best", func(t *testing.T) {
		rec := do(t, api, http.MethodPost, "/api/scores", scoreBody{
			PlayerID: player.ID, Game: "solitaire", Score: 5, Moves: 1, Duration: 1,
		})
		assertStatus(t, rec, http.StatusOK)

		got := decodeBody[submitResult](t, rec)
		if got.PersonalBest {
			t.Error("personal_best = true, want false")
		}
		if got.Best.Score != 1250 {
			t.Errorf("best = %d, want the surviving 1250", got.Best.Score)
		}
		if got.Submitted != 5 {
			t.Errorf("submitted = %d, want the run that was offered", got.Submitted)
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

func TestLeaderboardEndpoint(t *testing.T) {
	api := newTestAPI(t)

	rec := do(t, api, http.MethodGet, "/api/leaderboard", nil)
	assertStatus(t, rec, http.StatusOK)
	if got := rec.Body.String(); got != "[]\n" {
		t.Errorf("empty leaderboard = %q, want an empty JSON array (not null)", got)
	}

	newPlayer := func(name string) Player {
		return decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": name}))
	}

	// ACE is behind on both individual games but ahead on the combined total.
	ace := newPlayer("ACE")
	submit(t, api, ace.ID, "solitaire", 3000)
	submit(t, api, ace.ID, "sudoku", 2500)

	zed := newPlayer("ZED")
	submit(t, api, zed.ID, "solitaire", 4000)

	nova := newPlayer("NOVA")
	submit(t, api, nova.ID, "sudoku", 1000)

	t.Run("ranks on the combined total", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard", nil)
		assertStatus(t, rec, http.StatusOK)
		entries := decodeBody[[]LeaderboardEntry](t, rec)

		if len(entries) != 3 {
			t.Fatalf("len = %d, want 3", len(entries))
		}
		want := []struct {
			name  string
			total int
		}{{"ACE", 5500}, {"ZED", 4000}, {"NOVA", 1000}}
		for i, w := range want {
			if entries[i].PlayerName != w.name || entries[i].TotalScore != w.total {
				t.Errorf("rank %d = %s/%d, want %s/%d", i+1,
					entries[i].PlayerName, entries[i].TotalScore, w.name, w.total)
			}
		}
		if entries[0].Bests["sudoku"] != 2500 {
			t.Errorf("ACE bests = %v, want sudoku 2500", entries[0].Bests)
		}
	})

	t.Run("weaker repeat runs do not change the total", func(t *testing.T) {
		submit(t, api, ace.ID, "solitaire", 10)
		submit(t, api, ace.ID, "sudoku", 10)

		entries := decodeBody[[]LeaderboardEntry](t, do(t, api, http.MethodGet, "/api/leaderboard", nil))
		if entries[0].TotalScore != 5500 {
			t.Errorf("total = %d, want 5500 unchanged", entries[0].TotalScore)
		}
	})

	t.Run("a better run raises the total", func(t *testing.T) {
		submit(t, api, nova.ID, "sudoku", 9000)

		entries := decodeBody[[]LeaderboardEntry](t, do(t, api, http.MethodGet, "/api/leaderboard", nil))
		if entries[0].PlayerName != "NOVA" || entries[0].TotalScore != 9000 {
			t.Errorf("top = %s/%d, want NOVA/9000", entries[0].PlayerName, entries[0].TotalScore)
		}
	})

	t.Run("respects limit", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, "/api/leaderboard?limit=2", nil)
		assertStatus(t, rec, http.StatusOK)
		if entries := decodeBody[[]LeaderboardEntry](t, rec); len(entries) != 2 {
			t.Errorf("len = %d, want 2", len(entries))
		}
	})
}

func TestScoreDifficulty(t *testing.T) {
	api := newTestAPI(t)
	player := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "DIFF"}))

	// Each submission has to beat the last, otherwise it is correctly rejected
	// and nothing is written for us to inspect.
	score := 100
	postDifficulty := func(t *testing.T, difficulty string) submitResult {
		t.Helper()
		score += 100
		rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
			"player_id": player.ID, "game": "solitaire", "score": score,
			"moves": 5, "duration_seconds": 60, "won": true, "difficulty": difficulty,
		})
		assertStatus(t, rec, http.StatusCreated)
		return decodeBody[submitResult](t, rec)
	}

	t.Run("round-trips each difficulty", func(t *testing.T) {
		for _, want := range []string{"easy", "medium", "hard"} {
			if got := postDifficulty(t, want).Best.Difficulty; got != want {
				t.Errorf("difficulty = %q, want %q", got, want)
			}
		}
	})

	t.Run("unknown and missing values fall back to medium", func(t *testing.T) {
		for _, given := range []string{"", "IMPOSSIBLE", "  HARDER  "} {
			if got := postDifficulty(t, given).Best.Difficulty; got != "medium" {
				t.Errorf("difficulty for %q = %q, want medium", given, got)
			}
		}
	})

	t.Run("casing is normalized", func(t *testing.T) {
		if got := postDifficulty(t, "HARD").Best.Difficulty; got != "hard" {
			t.Errorf("difficulty = %q, want hard", got)
		}
	})

	t.Run("an unknown game falls back to solitaire", func(t *testing.T) {
		score += 100
		rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
			"player_id": player.ID, "game": "pinball", "score": score,
		})
		assertStatus(t, rec, http.StatusCreated)
		if got := decodeBody[submitResult](t, rec).Best.Game; got != "solitaire" {
			t.Errorf("game = %q, want solitaire", got)
		}
	})

	// The leaderboard aggregates players rather than runs, so difficulty now
	// lives on the stored best rather than on a leaderboard row.
	t.Run("the stored best carries the difficulty", func(t *testing.T) {
		rec := do(t, api, http.MethodGet, fmt.Sprintf("/api/players/%d/scores", player.ID), nil)
		assertStatus(t, rec, http.StatusOK)
		scores := decodeBody[[]Score](t, rec)
		if len(scores) == 0 {
			t.Fatal("expected at least one stored best")
		}
		for _, sc := range scores {
			if !validDifficulties[sc.Difficulty] {
				t.Errorf("score %+v has an unexpected difficulty", sc)
			}
		}
	})
}

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
INSERT INTO players (name) VALUES ('ROOKIE');
-- The old model kept every run, so a player has many rows.
INSERT INTO scores (player_id, score, moves, duration_seconds, won) VALUES
  (1,  900, 40, 200, FALSE),
  (1, 4200,120, 300, TRUE),
  (1,  150, 10,  60, FALSE),
  (1, 4200,111, 290, TRUE),
  (2,   75,  5,  30, FALSE);`)
	if err != nil {
		t.Fatalf("seed legacy schema: %v", err)
	}
	legacy.Close()

	store, err := OpenStore(dsn)
	if err != nil {
		t.Fatalf("OpenStore on a legacy database: %v", err)
	}

	t.Run("collapses each player's history to their best", func(t *testing.T) {
		rows, err := store.PlayerScores(1, 50)
		if err != nil {
			t.Fatalf("PlayerScores: %v", err)
		}
		if len(rows) != 1 {
			t.Fatalf("OLDTIMER kept %d rows, want exactly 1 after collapsing", len(rows))
		}
		if rows[0].Score != 4200 {
			t.Errorf("kept score = %d, want the best 4200", rows[0].Score)
		}
		// The tie between the two 4200s must resolve to the earlier row.
		if rows[0].Moves != 120 {
			t.Errorf("kept moves = %d, want 120 (the earlier of the tied rows)", rows[0].Moves)
		}
	})

	t.Run("backfills game and difficulty", func(t *testing.T) {
		rows, _ := store.PlayerScores(1, 50)
		if rows[0].Game != "solitaire" {
			t.Errorf("game = %q, want solitaire", rows[0].Game)
		}
		if rows[0].Difficulty != "medium" {
			t.Errorf("difficulty = %q, want medium", rows[0].Difficulty)
		}
	})

	t.Run("leaderboard totals the collapsed rows", func(t *testing.T) {
		entries, err := store.Leaderboard(5)
		if err != nil {
			t.Fatalf("Leaderboard: %v", err)
		}
		if len(entries) != 2 {
			t.Fatalf("len(entries) = %d, want 2 players", len(entries))
		}
		if entries[0].PlayerName != "OLDTIMER" || entries[0].TotalScore != 4200 {
			t.Errorf("top = %s/%d, want OLDTIMER/4200", entries[0].PlayerName, entries[0].TotalScore)
		}
		if entries[1].TotalScore != 75 {
			t.Errorf("ROOKIE total = %d, want 75", entries[1].TotalScore)
		}
	})

	t.Run("the unique constraint now holds", func(t *testing.T) {
		// A second solitaire row for the same player must upsert, not insert.
		if _, _, err := store.SubmitScore(1, "solitaire", 9999, 1, 1, true, "hard"); err != nil {
			t.Fatalf("SubmitScore after migration: %v", err)
		}
		rows, _ := store.PlayerScores(1, 50)
		if len(rows) != 1 || rows[0].Score != 9999 {
			t.Errorf("rows = %+v, want a single row at 9999", rows)
		}
	})

	store.Close()

	// Opening again must be a no-op rather than a duplicate-column error.
	again, err := OpenStore(dsn)
	if err != nil {
		t.Fatalf("second OpenStore: %v", err)
	}
	again.Close()
}

// A client that is a version ahead must not be rejected outright: unknown
// fields are ignored so an additive frontend change cannot take the API down.
func TestUnknownFieldsAreIgnored(t *testing.T) {
	api := newTestAPI(t)
	player := decodeBody[Player](t, do(t, api, http.MethodPost, "/api/players", map[string]string{"name": "FUTURE"}))

	rec := do(t, api, http.MethodPost, "/api/scores", map[string]any{
		"player_id": player.ID,
		"game":      "sudoku",
		"score":     1234,
		"won":       true,
		// Fields a future frontend might add before the API knows them.
		"combo_multiplier": 3,
		"achievements":     []string{"speedrun"},
		"telemetry":        map[string]any{"fps": 60},
	})
	assertStatus(t, rec, http.StatusCreated)

	got := decodeBody[submitResult](t, rec)
	if got.Best.Score != 1234 || got.Best.Game != "sudoku" {
		t.Errorf("known fields should still be honoured, got %+v", got.Best)
	}

	// A player creation with extra fields must work too.
	rec = do(t, api, http.MethodPost, "/api/players", map[string]any{"name": "EXTRA", "avatar": "cat"})
	assertStatus(t, rec, http.StatusCreated)
	if decodeBody[Player](t, rec).Name != "EXTRA" {
		t.Error("player name should still be read")
	}

	// Genuinely malformed JSON is still rejected.
	req := httptest.NewRequest(http.MethodPost, "/api/scores", bytes.NewReader([]byte("{not json")))
	rec2 := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec2, req)
	assertStatus(t, rec2, http.StatusBadRequest)
}

// Health advertises the games this build knows, so a stale deploy is visible
// without a score submission that could overwrite a personal best.
func TestHealthReportsSupportedGames(t *testing.T) {
	api := newTestAPI(t)

	rec := do(t, api, http.MethodGet, "/api/health", nil)
	assertStatus(t, rec, http.StatusOK)

	var body struct {
		Status string   `json:"status"`
		Games  []string `json:"games"`
		Commit string   `json:"commit"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}

	want := []string{"solitaire", "sudoku", "wordle"}
	if len(body.Games) != len(want) {
		t.Fatalf("games = %v, want %v", body.Games, want)
	}
	for i, game := range want {
		if body.Games[i] != game {
			t.Errorf("games[%d] = %q, want %q (sorted)", i, body.Games[i], game)
		}
	}

	// Every advertised game must actually be accepted, or the report lies.
	for _, game := range body.Games {
		if NormalizeGame(game) != game {
			t.Errorf("health advertises %q but NormalizeGame rewrites it to %q", game, NormalizeGame(game))
		}
	}
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
	if body := decodeBody[map[string]any](t, rec); body["status"] != "ok" {
		t.Errorf("status = %v, want ok", body["status"])
	}
}
