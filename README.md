# 🕹 Arcade

Three games — **Klondike Solitaire** (draw one, 52-card deck, drag and drop),
**Sudoku** (uniquely-solvable puzzles) and **Wordle** (five letters, six tries) —
sharing one player roster, one score model and one arcade-cabinet shell, on a
Go + Postgres backend.

```
solitare/
├── backend/          Go API + Postgres store
│   ├── main.go       server, graceful shutdown, optional static hosting
│   ├── db.go         schema, queries, name normalisation
│   ├── handlers.go   HTTP routes, CORS, JSON helpers
│   └── *_test.go     store + endpoint tests
└── frontend/         React 18 + TypeScript + Vite
    └── src/
        ├── game/     one engine per game, word lists, drag controller, sound
        ├── components/  menu, board, cards, HUD, leaderboard, win screen
        ├── api/       typed client for the Go API
        └── styles/    arcade shell + playing-card artwork
```

## Running it

You need a Postgres to point at. The quickest local one:

```bash
docker run -d --name solitaire-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=dev -e POSTGRES_DB=solitaire -p 5432:5432 postgres:16-alpine
```

Then two terminals. **Backend** (defaults to `:8080`, creates its tables on
first run):

```bash
cd backend && DATABASE_URL='postgres://dev:dev@localhost:5432/solitaire?sslmode=disable' go run .
```

**Frontend** (Vite dev server on `:5173`, proxies `/api` to the backend):

```bash
cd frontend && npm install && npm run dev
```

Then open <http://localhost:5173>.

### Single-binary deploy

Build the front end into the backend's `static/` directory and the Go server
will host both the API and the app. Because everything is same-origin, the
frontend's relative `/api` calls just work and no `VITE_API_URL` is needed:

```bash
cd frontend && npm run build && cp -r dist ../backend/static
cd ../backend && go build -o solitaire . && ./solitaire
```

## Tests

The Go tests need a Postgres to create scratch databases on. They **skip**
rather than fail when `TEST_DATABASE_URL` is unset:

```bash
docker run -d --name solitaire-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test -e POSTGRES_DB=test -p 55432:5432 postgres:16-alpine
cd backend && TEST_DATABASE_URL='postgres://test:test@localhost:55432/test?sslmode=disable' go test -race ./...
```

Each test creates and drops its own database, so they are isolated and safe to
run in parallel.

```bash
cd frontend && npm test
```

The engine suite covers deck integrity, the deal, every placement rule, the
scoring table, stock recycling, auto-complete, and win detection — plus 30
seeded full playthroughs asserting that cards are never lost, duplicated, or
illegally revealed.

## Scoring across the arcade

The leaderboard ranks **players**, not runs, on their **combined total**: their
best score in each game, summed. A run is only stored if it beats your existing
best for that game — weaker runs are reported back and discarded, never written.

That makes the `scores` table one row per player per game, so the arcade total
is a `SUM` over it rather than something recomputed from a history. The API
answers every submission with `personal_best`, and returns `201` when the run
replaced your best or `200` when the old one survived.

Both games use the same difficulty multipliers (×1 / ×1.6 / ×2.5) so a hard run
is worth the same premium whichever cabinet you play, and both are tuned to land
a good win in roughly the same 2,500–5,000 range.

## How to play

| Action | Control |
| --- | --- |
| Move cards | Drag a card or a valid run onto its destination |
| Send a card home | Double-click it, or single-click when a foundation will take it |
| Draw | Click the stock (or press <kbd>Space</kbd> / <kbd>D</kbd>) |
| Recycle the waste | Click the empty stock — costs 100 points |
| Undo | <kbd>U</kbd> or <kbd>⌘Z</kbd> |
| Hint | <kbd>H</kbd> |

Standard Klondike rules: build the tableau down in alternating colours, move
kings (or king-headed runs) to empty columns, build foundations up by suit from
the ace. When every card is face up and the stock is empty, an **Auto Finish**
button appears.

### Dead ends

Not every deal is winnable, and a game can also be played into a corner. Two
situations are detected:

**No moves left** — the engine proves that not one legal move remains, now or
after any number of trips through the stock. The game ends and the score is
banked. This is exact, never a guess: `isDeadEnd` returns true only when every
source position has been checked against every destination.

The proof is cheap because of a property of draw-one with unlimited redeals:
*every* card in the stock and waste eventually reaches the top of the waste, and
cycling never changes the tableau. So a card that fits nowhere now will not fit
later either, and the whole set can be tested directly instead of simulating
passes.

**No way forward** — legal moves remain, but none of them uncover a card, free a
column, or bank a card: a jack sliding back and forth between two queens, a king
hopping between empty columns. The game offers to end rather than ending itself,
because this is a next-move heuristic, not proof the deal is lost. Undo is
offered alongside, since backing up often reopens the position.

Note the third case, which is **not** detected: a deal that still has plenty of
productive moves but can no longer be won — four kings stacked over cards you
need, say. Deciding that requires searching the game tree, which is a different
piece of work from either check above.

### Difficulty

Chosen on the main menu; every mode is an ordinary honest shuffle, just sampled
from a different part of the distribution. Nothing is stacked or rearranged
after dealing.

| Mode | Score | What you get |
| --- | --- | --- |
| EASY | ×1 | Guaranteed winnable |
| MEDIUM | ×1.6 | An ordinary shuffle |
| HARD | ×2.5 | Buried aces, few early openings |

**How it works.** Grading a deal by eye doesn't work and solving Klondike
outright is expensive, so the dealer uses a played-out yardstick instead:
`gradeDeal()` runs a deliberately simple greedy player over a candidate shuffle
and reports how many cards it banks. `dealFor()` then keeps shuffling until one
lands in the requested band.

Measuring 4000 random shuffles showed the result is sharply **bimodal** — the
greedy player either finishes a deal outright (~11% of shuffles) or stalls out
low (median 9 cards, 75th percentile 15). Almost nothing lands between 20 and
52, so the bands sit either side of that gap rather than splitting the range
evenly:

| Mode | Band | Share of shuffles | Mean cards banked |
| --- | --- | --- | --- |
| EASY | 52 | 10.4% | 52.0 |
| MEDIUM | 8–20 | 47.5% | 11.8 |
| HARD | 0–4 | 14.6% | 2.9 |

Because the easy band requires the playout to bank all 52, an easy deal comes
with a **played-out proof that a win exists** — not an estimate.

Rejection sampling costs 0.6–2.3ms per deal in practice. The search is capped
at 200 attempts and falls back to the closest candidate seen, so it always
returns a playable deal; the odds of ever needing that fallback are below
1e-9 for the narrowest band.

The multiplier scales base points **and** the time bonus, and is recorded with
every run so the leaderboard can show which mode a score came from.

### Sudoku

| Action | Control |
| --- | --- |
| Select a cell | Click, or the arrow keys |
| Enter a digit | <kbd>1</kbd>–<kbd>9</kbd>, or the number pad |
| Erase | <kbd>Backspace</kbd> |
| Pencil marks | <kbd>N</kbd> toggles note mode |
| Hint | <kbd>H</kbd> — reveals a cell, costs 75 |
| Undo | <kbd>U</kbd> or <kbd>⌘Z</kbd> |

Every puzzle is generated with a **guaranteed unique solution**: a full grid is
built by randomised backtracking, then clues are removed one at a time and a
removal is kept only when the puzzle still solves exactly one way. Difficulty is
how many clues survive — easy 36–45, medium 30–35, hard 25–29, never below the
17-clue minimum. Generation takes about a millisecond.

Wrong digits are allowed onto the board, because seeing the clash is how you
notice the mistake — they just cost points.

**Sudoku scoring**

| Event | Points |
| --- | --- |
| Cell solved correctly | +12, paid once per cell |
| Mistake | −20 |
| Hint | −75 |
| Completing the grid | +400 |

The time bonus is `400000 / seconds`, **scaled by the share of blanks you worked
out yourself**. Without that scaling, hint-spamming is the highest-scoring
strategy — the per-hint penalty floors at zero while a fast finish pays a bonus
that dwarfs everything else. A grid you revealed entirely earns no time bonus.

### Wordle

| Action | Control |
| --- | --- |
| Type a letter | Any letter key, or the on-screen keyboard |
| Guess | <kbd>Enter</kbd> |
| Delete | <kbd>Backspace</kbd> |

Green means right letter, right place; yellow means right letter, wrong place.
Difficulty changes the number of tries and whether **hard mode** applies — easy
gives seven, medium six, hard six plus the rule that every revealed hint must be
reused in later guesses.

**Word lists.** Two of them, for the reason every Wordle clone eventually
discovers: the set of words you should *accept* is much larger than the set you
should *ask for*. `GUESSES` is every five-letter word in the system dictionary
(Webster's 1913 via `/usr/share/dict/words`, public domain) so reasonable guesses
are not rejected; `ANSWERS` is a curated list of ordinary words, because being
asked to find `fubsy` or `vealy` is not a game. Regenerate with the script in
`src/game/words.ts`'s header comment.

**Marking duplicate letters** is where naive implementations break, so it is done
in the standard two passes: exact matches are marked first and consume their
letter from a pool, then remaining letters are marked yellow only while the pool
still holds one.

Worked example — answer `geese`, guess `eexxe` → `present correct absent absent
correct`. Two of the answer's three `e`s are matched exactly at indices 1 and 4;
the third, at index 2, is what backs the yellow at index 0. Get the bookkeeping
wrong and you either over-report yellows or lose that one.

The invariant the tests pin, from both directions, is that for every letter the
count of `correct` + `present` marks equals `min(count in guess, count in
answer)` — so neither over- nor under-reporting can slip through.

**Wordle scoring**

| Event | Points |
| --- | --- |
| Solving it | +300, plus `900 − (guesses − 1) × 130` |
| Each newly confirmed green | +40 |
| Each newly confirmed yellow | +15 |

Positions only pay once, so re-guessing the same word cannot farm points. Time
bonus is `min(900, 120000 / seconds)` on a win of at least 20 seconds.

### Solitaire scoring

| Event | Points |
| --- | --- |
| Waste → tableau | +5 |
| Waste → foundation | +10 |
| Tableau → foundation | +10 |
| Turning over a tableau card | +5 |
| Foundation → tableau | −15 |
| Recycling the waste | −100 |

The score never drops below zero. Winning adds a time bonus of
`700000 / seconds`, awarded on wins that take at least 30 seconds.

Leaving a game part-way still banks the current score as an unfinished run, so
the leaderboard reflects everything played. Completed games are marked with a ★.

## API

No passwords — this is an arcade cabinet. A player is just a handle, normalised
to uppercase and limited to 1–12 characters of `A–Z 0–9`, space, `-` and `_`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, plus the games this build supports and its commit — `{"status":"ok","games":["solitaire","sudoku","wordle"],"commit":"4bf972e"}` |
| `GET` | `/api/players` | All players with best score and games played |
| `POST` | `/api/players` | Create a player — `{"name": "ZED"}`. Returns `201`; an existing handle returns `200` with that player, so creating and selecting are the same gesture |
| `GET` | `/api/players/{id}` | One player with aggregates |
| `GET` | `/api/players/{id}/scores` | That player's runs, best first (`?limit=`) |
| `POST` | `/api/scores` | Offer a run — `{"player_id":1,"game":"sudoku","score":1250,"moves":90,"duration_seconds":240,"won":true,"difficulty":"hard"}`. Returns `{personal_best, submitted, best}`; `201` if it replaced your best, `200` if not |
| `GET` | `/api/leaderboard` | Players ranked by combined total, with a per-game breakdown (`?limit=`, default 5) |

```bash
curl -X POST localhost:8080/api/players -d '{"name":"zed"}'
curl 'localhost:8080/api/leaderboard?limit=5'
```

### Database

Postgres via `jackc/pgx`. The schema is created on startup, and `DATABASE_URL`
is the only required setting:

```sql
players(id, name UNIQUE, created_at)
scores(id, player_id → players.id, game, score, moves, duration_seconds, won, difficulty, created_at)
  UNIQUE (player_id, game)
```

`game` is `solitaire`, `sudoku` or `wordle`. The unique constraint is what enforces
"personal bests only" — submissions upsert with
`ON CONFLICT (player_id, game) DO UPDATE ... WHERE EXCLUDED.score > scores.score`,
so a weaker run matches no row and writes nothing.

Databases from before the arcade held a full run history. Startup collapses each
player down to their best per game (earliest row wins a tie) before creating the
unique index, so upgrading in place is safe.

Leaderboard rows are players, ordered by combined total descending then by name.
Players with no score at all are left off.

Handles are stored upper-cased by `NormalizeName`, so a plain `UNIQUE`
constraint gives case-insensitive names without a `citext` column.

`difficulty` is one of `easy` / `medium` / `hard`; anything else is stored as
`medium` rather than rejected, since the run has already been played. Databases
created before this column existed are migrated on startup, and their existing
rows read back as `medium`.

On startup the server waits up to 30s for the database to accept connections,
so a cold start where the app boots before its database does not become a crash
loop.

### Configuration

**Backend**

| Flag | Env | Default | Notes |
| --- | --- | --- | --- |
| `-db` | `DATABASE_URL` | *(required)* | Postgres connection URL |
| `-addr` | `PORT` / `SOLITAIRE_ADDR` | `:8080` | `PORT` wins; hosts inject it |
| `-static` | `SOLITAIRE_STATIC` | `static` | Skipped if the directory is absent |
| | `CORS_ORIGINS` | *(unset — allows any)* | Comma-separated allow-list |

**Frontend**

| Env | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | *(unset — relative `/api`)* | Backend origin. **Build-time**, not runtime |
| `PORT` | `4173` | Port `npm start` serves `dist/` on |

## Deploying to Railway

Three services in one project: **Postgres**, **backend** (root directory
`backend`), **frontend** (root directory `frontend`).

The one thing that catches people out: **the frontend is a static bundle, so the
browser calls the backend directly.** Railway's private network
(`*.railway.internal`) is not reachable from a browser, so the backend needs its
own generated public domain — not just the frontend.

**1. Postgres.** *New → Database → Add PostgreSQL.* It publishes `DATABASE_URL`
on the private network; nothing to configure.

**2. Backend.** Generate a domain for it under *Settings → Networking*, then set:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `CORS_ORIGINS` | `https://<your-frontend-domain>` |

`${{Postgres.DATABASE_URL}}` is a Railway reference variable — it resolves to
the private-network URL, so database traffic never leaves the project. Do not
set `PORT`; Railway injects it.

**3. Frontend.** Set:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://<your-backend-domain>` |

No trailing slash and no `/api` suffix — the client appends that itself.

Because Vite inlines `VITE_API_URL` at **build** time, changing it requires a
redeploy to take effect; restarting the service is not enough.

Deploy the backend first so the database schema exists, then the frontend.

## Implementation notes

- **The rules engine** (`src/game/engine.ts`) is pure and framework-free: every
  move returns a new `GameState` or `null` if illegal. That is what makes the
  headless test suite possible.
- **Dragging** uses pointer events rather than HTML5 drag-and-drop, so a whole
  run lifts and follows the cursor with a live drop-target highlight. Hit
  testing is `elementFromPoint` against `data-drop` attributes, with the drag
  layer set to `pointer-events: none` so it sees the table underneath.
- **Cards are drawn in CSS**, not images: real pip layouts for 2–10 (lower-half
  pips rotated, as on a printed deck), mirrored court panels, and a lattice
  card back. Everything scales from the `--card-w` / `--card-h` custom
  properties, which media queries rescale for smaller screens.
- **Sound** is synthesised with WebAudio oscillators, so there are no audio
  assets. Mute with the speaker button.
