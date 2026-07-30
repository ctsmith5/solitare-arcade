import { DIFFICULTY_BONUS } from './difficulty.ts'
import type { Difficulty } from './types.ts'
import { CELLS, generate, hint as hintIndex, isSolved } from './sudoku.ts'
import type { Digit, Grid } from './sudoku.ts'

/* ------------------------------------------------------------------ *
 * Scoring — tuned so a Sudoku run lands in the same range as a
 * Solitaire one, since the arcade total sums across both.
 * ------------------------------------------------------------------ */
export const SUDOKU_SCORE = {
  /** Per cell solved correctly, paid once however often it is re-entered. */
  correct: 12,
  mistake: -20,
  hint: -75,
  completion: 400,
} as const

export interface SudokuState {
  difficulty: Difficulty
  /** The dealt givens; never changes. */
  puzzle: Grid
  solution: Grid
  /** What the player currently has on the board. */
  grid: Grid
  /** Pencil marks per cell, as a bitmask where bit (d-1) means digit d. */
  notes: number[]
  /**
   * Cells already paid for. Without this, clearing and re-entering a correct
   * digit would farm points.
   */
  awarded: boolean[]
  /** Blanks in the deal, so the time bonus can tell solving from revealing. */
  blanks: number
  score: number
  mistakes: number
  hintsUsed: number
  startedAt: number
  wonAt: number | null
}

export function newSudoku(difficulty: Difficulty, rng: () => number = Math.random): SudokuState {
  const { puzzle, solution } = generate(difficulty, rng)
  return {
    difficulty,
    blanks: puzzle.reduce<number>((n, cell) => (cell === 0 ? n + 1 : n), 0),
    puzzle,
    solution,
    grid: puzzle.slice(),
    notes: new Array<number>(CELLS).fill(0),
    awarded: new Array<boolean>(CELLS).fill(false),
    score: 0,
    mistakes: 0,
    hintsUsed: 0,
    startedAt: Date.now(),
    wonAt: null,
  }
}

export const isGiven = (state: SudokuState, index: number): boolean => state.puzzle[index] !== 0

const clone = (state: SudokuState): SudokuState => ({
  ...state,
  grid: state.grid.slice(),
  notes: state.notes.slice(),
  awarded: state.awarded.slice(),
})

function finalize(state: SudokuState): SudokuState {
  if (!state.wonAt && isSolved(state.grid)) {
    state.wonAt = Date.now()
    state.score += SUDOKU_SCORE.completion
  }
  return state
}

/**
 * Writes a digit. Wrong digits are allowed onto the board — seeing the clash is
 * how you learn it was wrong — but they cost points and count as a mistake.
 */
export function placeDigit(state: SudokuState, index: number, digit: Digit): SudokuState | null {
  if (state.wonAt || isGiven(state, index)) return null
  if (state.grid[index] === digit) return null

  const next = clone(state)
  next.grid[index] = digit
  // Committing a digit clears that cell's pencil marks, as on paper.
  next.notes[index] = 0

  if (digit === state.solution[index]) {
    if (!next.awarded[index]) {
      next.awarded[index] = true
      next.score += SUDOKU_SCORE.correct
    }
  } else {
    next.mistakes += 1
    next.score = Math.max(0, next.score + SUDOKU_SCORE.mistake)
  }
  return finalize(next)
}

export function clearCell(state: SudokuState, index: number): SudokuState | null {
  if (state.wonAt || isGiven(state, index)) return null
  if (state.grid[index] === 0 && state.notes[index] === 0) return null

  const next = clone(state)
  next.grid[index] = 0
  next.notes[index] = 0
  return next
}

export function toggleNote(state: SudokuState, index: number, digit: Digit): SudokuState | null {
  if (state.wonAt || isGiven(state, index) || state.grid[index] !== 0) return null

  const next = clone(state)
  next.notes[index] ^= 1 << (digit - 1)
  return next
}

export const noteDigits = (mask: number): Digit[] =>
  ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]).filter((d) => (mask & (1 << (d - 1))) !== 0)

/** Reveals the most useful blank cell, at a price. */
export function useHint(state: SudokuState): SudokuState | null {
  if (state.wonAt) return null

  const index = hintIndex(state.grid, state.solution)
  if (index === null) return null

  const next = clone(state)
  next.grid[index] = state.solution[index]
  next.notes[index] = 0
  next.hintsUsed += 1
  next.score = Math.max(0, next.score + SUDOKU_SCORE.hint)
  // A revealed cell is never paid for, so it cannot be farmed either.
  next.awarded[index] = true
  return finalize(next)
}

/** Blank cells remaining. */
export const remaining = (state: SudokuState): number =>
  // Explicit type argument: Grid is Cell[], so inference would otherwise pin
  // the accumulator to Cell rather than a plain count.
  state.grid.reduce<number>((n, cell) => (cell === 0 ? n + 1 : n), 0)

/** How many of each digit are already placed, for greying out a full number. */
export function digitCounts(state: SudokuState): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
  for (const cell of state.grid) if (cell !== 0) counts[cell] += 1
  return counts
}

/* ---- final score ------------------------------------------------- */

export const elapsedSeconds = (state: SudokuState): number =>
  Math.max(0, Math.floor(((state.wonAt ?? Date.now()) - state.startedAt) / 1000))

/**
 * Time bonus for a win of at least 30 seconds, scaled by the share of blanks
 * the player actually worked out.
 *
 * Without that scaling, spamming hints is the highest-scoring strategy: the
 * per-hint penalty floors at zero, but finishing in seconds pays a bonus that
 * dwarfs everything else. Revealed cells earning no bonus removes the exploit
 * and keeps a Sudoku win in the same range as a Solitaire one.
 */
export function timeBonus(state: SudokuState): number {
  if (!state.wonAt) return 0
  const seconds = elapsedSeconds(state)
  if (seconds < 30) return 0

  const selfSolved = Math.max(0, state.blanks - state.hintsUsed)
  const share = state.blanks === 0 ? 0 : selfSolved / state.blanks
  return Math.floor((400_000 / seconds) * share)
}

export const finalScore = (state: SudokuState): number =>
  Math.round((state.score + timeBonus(state)) * DIFFICULTY_BONUS[state.difficulty])
