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

const BASE = '/api'

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
