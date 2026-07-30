import { DIFFICULTY_BONUS } from './difficulty.ts'
import type { Difficulty } from './types.ts'
import { ANSWERS, GUESSES, WORD_LENGTH } from './words.ts'

export type LetterMark = 'correct' | 'present' | 'absent'

export interface ScoredGuess {
  word: string
  /** One mark per letter, so always WORD_LENGTH long. */
  marks: LetterMark[]
}

/* ------------------------------------------------------------------ *
 * Scoring — tuned so a Wordle run lands in the same range as a
 * Solitaire or Sudoku one, since the arcade total sums across all three.
 * ------------------------------------------------------------------ */
export const WORDLE_SCORE = {
  completion: 300,
  /** Per position turned green, paid once however often it is re-guessed. */
  perGreen: 40,
  /** Per letter revealed as present, paid once per letter. */
  perYellow: 15,
} as const

/** Solving in fewer guesses is worth more: 900 down to 250 over six rows. */
const GUESS_BONUS_BASE = 900
const GUESS_BONUS_STEP = 130

export const MAX_GUESSES: Record<Difficulty, number> = {
  easy: 7,
  medium: 6,
  hard: 6,
}

export interface WordleState {
  difficulty: Difficulty
  answer: string
  guesses: ScoredGuess[]
  maxGuesses: number
  /** 'a'..'z' → the best mark that letter has earned, for the on-screen keyboard. */
  keyboard: Record<string, LetterMark>
  hardMode: boolean
  score: number
  startedAt: number
  wonAt: number | null
  lostAt: number | null
}

const MARK_RANK: Record<LetterMark, number> = { absent: 0, present: 1, correct: 2 }

/**
 * The two-pass mark: exact matches are taken out of the answer's letter pool
 * first, so a duplicate letter can never claim a yellow the answer cannot back.
 */
export function scoreGuess(guess: string, answer: string): LetterMark[] {
  const g = guess.toLowerCase()
  const a = answer.toLowerCase()
  const marks = new Array<LetterMark>(WORD_LENGTH).fill('absent')

  const pool: Record<string, number> = {}
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === a[i]) marks[i] = 'correct'
    else pool[a[i]] = (pool[a[i]] ?? 0) + 1
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (marks[i] === 'correct') continue
    if ((pool[g[i]] ?? 0) > 0) {
      pool[g[i]] -= 1
      marks[i] = 'present'
    }
  }
  return marks
}

export function newWordle(difficulty: Difficulty, rng: () => number = Math.random): WordleState {
  // Clamped: an rng that can return exactly 1 would otherwise index off the end.
  const index = Math.min(ANSWERS.length - 1, Math.floor(rng() * ANSWERS.length))
  return {
    difficulty,
    answer: ANSWERS[index],
    guesses: [],
    maxGuesses: MAX_GUESSES[difficulty],
    keyboard: {},
    hardMode: difficulty === 'hard',
    score: 0,
    startedAt: Date.now(),
    wonAt: null,
    lostAt: null,
  }
}

export function isValidGuess(word: string): boolean {
  const w = word.toLowerCase()
  return w.length === WORD_LENGTH && /^[a-z]+$/.test(w) && GUESSES.has(w)
}

export const isOver = (state: WordleState): boolean => state.wonAt !== null || state.lostAt !== null

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th']

/** What the guesses so far have pinned down: greens by position, yellows by letter. */
function revealed(state: WordleState): { fixed: (string | null)[]; required: string[] } {
  const fixed = new Array<string | null>(WORD_LENGTH).fill(null)
  const required: string[] = []
  for (const guess of state.guesses) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      if (guess.marks[i] === 'correct') fixed[i] = guess.word[i]
      else if (guess.marks[i] === 'present' && !required.includes(guess.word[i])) {
        required.push(guess.word[i])
      }
    }
  }
  return { fixed, required }
}

/** Why hard mode refuses this guess, or null if it is fine. */
export function hardModeViolation(state: WordleState, guess: string): string | null {
  if (!state.hardMode) return null

  const word = guess.toLowerCase()
  const { fixed, required } = revealed(state)

  for (let i = 0; i < WORD_LENGTH; i++) {
    const letter = fixed[i]
    if (letter && word[i] !== letter) {
      return `${ORDINAL[i]} letter must be ${letter.toUpperCase()}`
    }
  }
  for (const letter of required) {
    if (!word.includes(letter)) return `Guess must use ${letter.toUpperCase()}`
  }
  return null
}

const isRevealed = (mark: LetterMark | undefined): boolean => mark === 'present' || mark === 'correct'

const bestMark = (current: LetterMark | undefined, mark: LetterMark): LetterMark =>
  current && MARK_RANK[current] >= MARK_RANK[mark] ? current : mark

/**
 * Plays a guess, or returns null if it is refused — over, unknown word, or
 * hard mode. A refused guess never costs a row.
 */
export function submitGuess(state: WordleState, guess: string): WordleState | null {
  if (isOver(state)) return null

  const word = guess.toLowerCase()
  if (!isValidGuess(word)) return null
  if (hardModeViolation(state, word)) return null

  const marks = scoreGuess(word, state.answer)
  const { fixed } = revealed(state)

  const keyboard = { ...state.keyboard }
  // Positions already green and letters already revealed pay nothing, so
  // resubmitting a known-good guess cannot farm points.
  const paidYellow = new Set<string>()
  let gained = 0

  for (let i = 0; i < WORD_LENGTH; i++) {
    const letter = word[i]
    const mark = marks[i]
    if (mark === 'correct' && fixed[i] === null) {
      gained += WORDLE_SCORE.perGreen
    } else if (mark === 'present' && !paidYellow.has(letter) && !isRevealed(state.keyboard[letter])) {
      paidYellow.add(letter)
      gained += WORDLE_SCORE.perYellow
    }
    keyboard[letter] = bestMark(keyboard[letter], mark)
  }

  const guesses = [...state.guesses, { word, marks }]
  const won = marks.every((mark) => mark === 'correct')
  const lost = !won && guesses.length >= state.maxGuesses
  if (won) {
    gained += WORDLE_SCORE.completion
    gained += Math.max(0, GUESS_BONUS_BASE - (guesses.length - 1) * GUESS_BONUS_STEP)
  }

  return {
    ...state,
    guesses,
    keyboard,
    score: Math.max(0, state.score + gained),
    wonAt: won ? Date.now() : null,
    lostAt: lost ? Date.now() : null,
  }
}

/* ---- final score ------------------------------------------------- */

export const elapsedSeconds = (state: WordleState): number =>
  Math.max(0, Math.floor(((state.wonAt ?? state.lostAt ?? Date.now()) - state.startedAt) / 1000))

/**
 * Time bonus for a win. The 20 second floor keeps a lucky first-row guess from
 * dividing by almost nothing, and the cap keeps it from dwarfing the solve.
 */
export function timeBonus(state: WordleState): number {
  if (!state.wonAt) return 0
  const seconds = elapsedSeconds(state)
  if (seconds < 20) return 0
  return Math.min(900, Math.floor(120_000 / seconds))
}

export const finalScore = (state: WordleState): number =>
  Math.round((state.score + timeBonus(state)) * DIFFICULTY_BONUS[state.difficulty])
