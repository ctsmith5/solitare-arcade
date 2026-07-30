export interface Player {
  id: number
  name: string
  created_at: string
  /** Sum of the player's best in every game — what the arcade ranks on. */
  total_score: number
  /** Highest single-game best. */
  best_score: number
  games_won: number
  games_played: number
  bests: Partial<Record<GameKey, number>>
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export type GameKey = 'solitaire' | 'sudoku'

/** One row of the arcade table: a player, ranked on their combined total. */
export interface LeaderboardEntry {
  rank: number
  player_id: number
  player_name: string
  total_score: number
  games_played: number
  games_won: number
  /** Best score per game, e.g. { solitaire: 3200, sudoku: 1800 }. */
  bests: Partial<Record<GameKey, number>>
}

export interface ScoreSubmission {
  player_id: number
  game: GameKey
  score: number
  moves: number
  duration_seconds: number
  won: boolean
  difficulty: Difficulty
}

export interface StoredScore {
  id: number
  player_id: number
  player_name: string
  game: GameKey
  score: number
  moves: number
  duration_seconds: number
  won: boolean
  difficulty: Difficulty
  created_at: string
}

/** Only a personal best is kept, so the API reports whether one was set. */
export interface SubmitResult {
  personal_best: boolean
  submitted: number
  best: StoredScore
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/*
 * Where the Go API lives.
 *
 * Unset (development): stay relative and let the Vite dev-server proxy in
 * vite.config.ts forward /api to localhost:8080.
 *
 * Set (production): call the backend's own origin, because a built SPA is just
 * static files — there is no proxy in front of it, so a relative /api would hit
 * the frontend's own domain and 404.
 *
 * Vite inlines this at BUILD time, so the variable must be present when
 * `vite build` runs, not merely at runtime.
 */
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
const BASE = `${API_ORIGIN}/api`

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('CABINET OFFLINE — BACKEND UNREACHABLE', 0)
  }

  if (!response.ok) {
    let message = `REQUEST FAILED (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error.toUpperCase()
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  listPlayers: () => request<Player[]>('/players'),

  createPlayer: (name: string) =>
    request<Player>('/players', { method: 'POST', body: JSON.stringify({ name }) }),

  getPlayer: (id: number) => request<Player>(`/players/${id}`),

  submitScore: (submission: ScoreSubmission) =>
    request<SubmitResult>('/scores', { method: 'POST', body: JSON.stringify(submission) }),

  leaderboard: (limit = 5) => request<LeaderboardEntry[]>(`/leaderboard?limit=${limit}`),
}
