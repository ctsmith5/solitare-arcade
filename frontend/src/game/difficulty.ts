import type { Difficulty } from './types.ts'

export type { Difficulty }

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
}

/**
 * Score multipliers, shared by every game in the arcade so a hard run is worth
 * the same premium whichever cabinet you play.
 */
export const DIFFICULTY_BONUS: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.6,
  hard: 2.5,
}

/** The games the arcade offers. Must match the backend's accepted values. */
export type GameKey = 'solitaire' | 'sudoku'

export interface GameSpec {
  key: GameKey
  title: string
  tagline: string
  /** Short label for the leaderboard breakdown chips. */
  short: string
}

export const GAMES: Record<GameKey, GameSpec> = {
  solitaire: {
    key: 'solitaire',
    title: 'SOLITAIRE',
    tagline: 'KLONDIKE · DRAW ONE · 52 CARDS',
    short: 'SOL',
  },
  sudoku: {
    key: 'sudoku',
    title: 'SUDOKU',
    tagline: 'ONE SOLUTION · NO GUESSING',
    short: 'SUD',
  },
}

export const GAME_ORDER: GameKey[] = ['solitaire', 'sudoku']

/**
 * What a difficulty means in each game. Solitaire varies the deal; Sudoku
 * varies how many cells you start with.
 */
export const DIFFICULTY_BLURB: Record<GameKey, Record<Difficulty, string>> = {
  solitaire: {
    easy: 'Guaranteed winnable',
    medium: 'An ordinary shuffle',
    hard: 'Buried aces, few openings',
  },
  sudoku: {
    easy: '36-45 starting cells',
    medium: '30-35 starting cells',
    hard: '25-29 starting cells',
  },
}
