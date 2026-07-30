export interface Player {
  id: number
  name: string
  created_at: string
  best_score: number
  games_won: number
  games_played: number
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface LeaderboardEntry {
  rank: number
  player_id: number
  player_name: string
  score: number
  moves: number
  duration_seconds: number
  won: boolean
  difficulty: Difficulty
  created_at: string
}

export interface ScoreSubmission {
  player_id: number
  score: number
  moves: number
  duration_seconds: number
  won: boolean
  difficulty: Difficulty
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
    request<unknown>('/scores', { method: 'POST', body: JSON.stringify(submission) }),

  leaderboard: (limit = 5) => request<LeaderboardEntry[]>(`/leaderboard?limit=${limit}`),
}
