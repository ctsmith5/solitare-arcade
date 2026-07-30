package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
)

type API struct {
	store *Store
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.health)

	mux.HandleFunc("GET /api/players", a.listPlayers)
	mux.HandleFunc("POST /api/players", a.createPlayer)
	mux.HandleFunc("GET /api/players/{id}", a.getPlayer)
	mux.HandleFunc("GET /api/players/{id}/scores", a.playerScores)

	mux.HandleFunc("POST /api/scores", a.createScore)
	mux.HandleFunc("GET /api/leaderboard", a.leaderboard)

	return withCORS(withLogging(mux))
}

// ---- handlers -----------------------------------------------------------

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) listPlayers(w http.ResponseWriter, r *http.Request) {
	players, err := a.store.ListPlayers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load players")
		return
	}
	writeJSON(w, http.StatusOK, players)
}

func (a *API) createPlayer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	player, err := a.store.CreatePlayer(body.Name)
	switch {
	case errors.Is(err, ErrInvalidName):
		writeErr(w, http.StatusBadRequest,
			"names must be 1-12 characters: letters, numbers, spaces, - or _")
		return
	case errors.Is(err, ErrPlayerExists):
		// Selecting an existing handle is the same gesture as creating one on a
		// cabinet with no passwords, so hand back the existing player.
		name, nerr := NormalizeName(body.Name)
		if nerr != nil {
			writeErr(w, http.StatusBadRequest, "invalid player name")
			return
		}
		existing, gerr := a.store.GetPlayerByName(name)
		if gerr != nil {
			writeErr(w, http.StatusConflict, "player already exists")
			return
		}
		writeJSON(w, http.StatusOK, existing)
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not create player")
		return
	}
	writeJSON(w, http.StatusCreated, player)
}

func (a *API) getPlayer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	player, err := a.store.GetPlayer(id)
	if errors.Is(err, ErrPlayerNotFound) {
		writeErr(w, http.StatusNotFound, "player not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load player")
		return
	}
	writeJSON(w, http.StatusOK, player)
}

func (a *API) playerScores(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	scores, err := a.store.PlayerScores(id, queryInt(r, "limit", 10))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load scores")
		return
	}
	writeJSON(w, http.StatusOK, scores)
}

func (a *API) createScore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PlayerID   int64  `json:"player_id"`
		Game       string `json:"game"`
		Score      int    `json:"score"`
		Moves      int    `json:"moves"`
		Duration   int    `json:"duration_seconds"`
		Won        bool   `json:"won"`
		Difficulty string `json:"difficulty"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.PlayerID <= 0 {
		writeErr(w, http.StatusBadRequest, "player_id is required")
		return
	}
	if body.Score < 0 || body.Moves < 0 || body.Duration < 0 {
		writeErr(w, http.StatusBadRequest, "score, moves and duration must not be negative")
		return
	}

	stored, isBest, err := a.store.SubmitScore(body.PlayerID, body.Game, body.Score,
		body.Moves, body.Duration, body.Won, body.Difficulty)
	if errors.Is(err, ErrPlayerNotFound) {
		writeErr(w, http.StatusNotFound, "player not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save score")
		return
	}

	// 201 when the run replaced the player's best, 200 when the existing best
	// survived, so the client can tell whether anything was actually written.
	status := http.StatusOK
	if isBest {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{
		"personal_best": isBest,
		"submitted":     body.Score,
		"best":          stored,
	})
}

func (a *API) leaderboard(w http.ResponseWriter, r *http.Request) {
	entries, err := a.store.Leaderboard(queryInt(r, "limit", 5))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load leaderboard")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// ---- helpers ------------------------------------------------------------

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

func queryInt(r *http.Request, key string, def int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	if n > 100 {
		return 100
	}
	return n
}

// decodeJSON reads a request body, ignoring fields it does not recognise.
//
// Deliberately tolerant: the frontend and API deploy independently, so the
// frontend is routinely a version ahead. Rejecting unknown fields turns any
// additive change into a total outage — a client sending a new field gets a 400
// for every request until the API catches up. Ignoring it degrades to "that
// field is not stored yet" instead, which is recoverable.
//
// The trade-off is that a misspelled field is silently dropped rather than
// reported, so every field that matters is validated explicitly by the handler.
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16))
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// allowedOrigins is the CORS allow-list, from a comma-separated CORS_ORIGINS.
// Empty (the default) allows any origin, which is fine here because the API
// carries no cookies or credentials — but setting it in production keeps other
// sites from driving your cabinet.
func allowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("CORS_ORIGINS"))
	if raw == "" {
		return nil
	}
	var out []string
	for _, origin := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			out = append(out, strings.TrimSuffix(trimmed, "/"))
		}
	}
	return out
}

func withCORS(next http.Handler) http.Handler {
	allowed := allowedOrigins()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSuffix(r.Header.Get("Origin"), "/")

		switch {
		case len(allowed) == 0:
			w.Header().Set("Access-Control-Allow-Origin", "*")
		case origin != "" && slices.Contains(allowed, origin):
			w.Header().Set("Access-Control-Allow-Origin", origin)
			// The response differs per origin, so caches must key on it.
			w.Header().Add("Vary", "Origin")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
