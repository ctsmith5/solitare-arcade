import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DIFFICULTY_BONUS } from './difficulty.ts'
import { CELLS } from './sudoku.ts'
import type { Digit } from './sudoku.ts'
import {
  SUDOKU_SCORE,
  clearCell,
  digitCounts,
  finalScore,
  isGiven,
  newSudoku,
  noteDigits,
  placeDigit,
  remaining,
  timeBonus,
  toggleNote,
  useHint,
} from './sudokuGame.ts'
import type { SudokuState } from './sudokuGame.ts'

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** The first blank cell, which every test needs. */
function firstBlank(state: SudokuState): number {
  const i = state.grid.findIndex((c) => c === 0)
  assert.notEqual(i, -1, 'puzzle should have a blank')
  return i
}

const wrongDigitFor = (state: SudokuState, index: number): Digit => {
  const right = state.solution[index]
  return (((right % 9) + 1) as Digit)
}

/** Fills every blank correctly, returning the finished state. */
function solveFully(state: SudokuState): SudokuState {
  let current = state
  for (let i = 0; i < CELLS; i++) {
    if (current.grid[i] !== 0) continue
    const next = placeDigit(current, i, current.solution[i] as Digit)
    assert.ok(next, `placing the solution digit at ${i} should be legal`)
    current = next
  }
  return current
}

/* ------------------------------------------------------------------ */

test('a new game starts from the givens with a clean slate', () => {
  const state = newSudoku('medium', seeded(1))
  assert.equal(state.grid.length, CELLS)
  assert.deepEqual(state.grid, state.puzzle, 'board starts as the givens')
  assert.equal(state.score, 0)
  assert.equal(state.mistakes, 0)
  assert.equal(state.hintsUsed, 0)
  assert.equal(state.wonAt, null)
  assert.equal(state.notes.filter((n) => n !== 0).length, 0)
})

test('givens cannot be changed', () => {
  const state = newSudoku('easy', seeded(2))
  const given = state.grid.findIndex((c) => c !== 0)
  assert.ok(isGiven(state, given))
  assert.equal(placeDigit(state, given, 5), null)
  assert.equal(clearCell(state, given), null)
  assert.equal(toggleNote(state, given, 5), null)
})

test('a correct digit scores once, however often it is re-entered', () => {
  const state = newSudoku('medium', seeded(3))
  const i = firstBlank(state)
  const right = state.solution[i] as Digit

  const first = placeDigit(state, i, right)!
  assert.equal(first.score, SUDOKU_SCORE.correct)

  // Clear and replace: the cell is already paid for, so no second payout.
  const cleared = clearCell(first, i)!
  const again = placeDigit(cleared, i, right)!
  assert.equal(again.score, SUDOKU_SCORE.correct, 'score farming must not be possible')
})

test('a wrong digit costs points and counts a mistake, but still lands', () => {
  const state = newSudoku('medium', seeded(4))
  const i = firstBlank(state)

  const scored = placeDigit(state, i, state.solution[i] as Digit)!
  const cleared = clearCell(scored, i)!
  const wrong = placeDigit(cleared, i, wrongDigitFor(state, i))!

  assert.equal(wrong.mistakes, 1)
  assert.equal(wrong.grid[i], wrongDigitFor(state, i), 'the wrong digit is visible on the board')
  assert.equal(wrong.score, Math.max(0, SUDOKU_SCORE.correct + SUDOKU_SCORE.mistake))
})

test('score never goes negative', () => {
  let state = newSudoku('medium', seeded(5))
  const i = firstBlank(state)
  for (let n = 0; n < 5; n++) {
    const next = placeDigit(state, i, wrongDigitFor(state, i))
    if (next) state = next
    // Re-entering the same wrong digit is a no-op, so alternate.
    const cleared = clearCell(state, i)
    if (cleared) state = cleared
  }
  assert.ok(state.score >= 0, `score = ${state.score}`)
})

test('placing the digit already there is a no-op', () => {
  const state = newSudoku('easy', seeded(6))
  const i = firstBlank(state)
  const placed = placeDigit(state, i, state.solution[i] as Digit)!
  assert.equal(placeDigit(placed, i, state.solution[i] as Digit), null)
})

test('notes toggle, survive until a digit is committed, and round-trip', () => {
  const state = newSudoku('medium', seeded(7))
  const i = firstBlank(state)

  const withNotes = toggleNote(toggleNote(state, i, 3)!, i, 7)!
  assert.deepEqual(noteDigits(withNotes.notes[i]), [3, 7])

  const toggledOff = toggleNote(withNotes, i, 3)!
  assert.deepEqual(noteDigits(toggledOff.notes[i]), [7])

  const committed = placeDigit(toggledOff, i, state.solution[i] as Digit)!
  assert.equal(committed.notes[i], 0, 'committing a digit clears the pencil marks')
})

test('notes are refused on a cell that already holds a digit', () => {
  const state = newSudoku('medium', seeded(8))
  const i = firstBlank(state)
  const placed = placeDigit(state, i, state.solution[i] as Digit)!
  assert.equal(toggleNote(placed, i, 4), null)
})

test('a hint reveals a correct digit, costs points, and cannot be farmed', () => {
  const state = newSudoku('hard', seeded(9))
  const before = remaining(state)

  const hinted = useHint(state)!
  assert.equal(hinted.hintsUsed, 1)
  assert.equal(remaining(hinted), before - 1)
  assert.equal(hinted.score, 0, 'a hint from zero cannot push the score negative')

  const revealed = hinted.grid.findIndex((c, i) => c !== 0 && state.grid[i] === 0)
  assert.equal(hinted.grid[revealed], hinted.solution[revealed])

  // Clearing and re-entering a revealed cell must not pay out.
  const cleared = clearCell(hinted, revealed)!
  const replaced = placeDigit(cleared, revealed, hinted.solution[revealed] as Digit)!
  assert.equal(replaced.score, hinted.score, 'revealed cells are already paid for')
})

test('mutations never touch the previous state', () => {
  const state = newSudoku('medium', seeded(10))
  const i = firstBlank(state)
  const snapshot = state.grid.slice()

  placeDigit(state, i, state.solution[i] as Digit)
  toggleNote(state, i, 5)
  useHint(state)

  assert.deepEqual(state.grid, snapshot, 'original grid untouched')
  assert.equal(state.score, 0)
})

test('filling the board correctly wins and pays the completion bonus', () => {
  const state = newSudoku('easy', seeded(11))
  const blanks = remaining(state)
  const done = solveFully(state)

  assert.ok(done.wonAt, 'should be won')
  assert.equal(remaining(done), 0)
  assert.equal(done.mistakes, 0)
  assert.equal(done.score, blanks * SUDOKU_SCORE.correct + SUDOKU_SCORE.completion)
})

test('a won board refuses further edits', () => {
  const done = solveFully(newSudoku('easy', seeded(12)))
  const anyCell = done.puzzle.findIndex((c) => c === 0)
  assert.equal(placeDigit(done, anyCell, 1), null)
  assert.equal(clearCell(done, anyCell), null)
  assert.equal(useHint(done), null)
})

test('digitCounts tracks what is on the board', () => {
  const state = newSudoku('easy', seeded(13))
  const counts = digitCounts(state)
  const placed = Object.values(counts).reduce((a, b) => a + b, 0)
  assert.equal(placed, CELLS - remaining(state))

  const done = solveFully(state)
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.equal(digitCounts(done)[d], 9, `digit ${d} should appear 9 times when solved`)
  }
})

test('hints do not earn a time bonus', () => {
  const base = { ...newSudoku('hard', seeded(20)), score: 1000, startedAt: 0, wonAt: 200_000 }
  const full = timeBonus(base)
  assert.ok(full > 0, 'a clean win should earn a bonus')

  const halfHinted = { ...base, hintsUsed: Math.floor(base.blanks / 2) }
  assert.ok(
    Math.abs(timeBonus(halfHinted) - full / 2) <= 1,
    `half-hinted bonus ${timeBonus(halfHinted)} should be about half of ${full}`,
  )

  // The exploit: reveal the whole grid fast and collect a huge bonus.
  const allHinted = { ...base, hintsUsed: base.blanks }
  assert.equal(timeBonus(allHinted), 0, 'a fully revealed grid earns no time bonus')
})

test('the difficulty multiplier scales the final score', () => {
  const base = { ...newSudoku('easy', seeded(14)), score: 1000, startedAt: 0, wonAt: 200_000 }
  const bonus = Math.floor(400_000 / 200)  // no hints used, so the full bonus

  assert.equal(timeBonus(base), bonus)
  assert.equal(finalScore(base), Math.round((1000 + bonus) * DIFFICULTY_BONUS.easy))

  const hard = { ...base, difficulty: 'hard' as const }
  assert.equal(finalScore(hard), Math.round((1000 + bonus) * DIFFICULTY_BONUS.hard))
  assert.ok(finalScore(hard) > finalScore(base))
})

test('an unfinished run gets no time bonus', () => {
  const state = { ...newSudoku('hard', seeded(15)), score: 500 }
  assert.equal(timeBonus(state), 0)
  assert.equal(finalScore(state), Math.round(500 * DIFFICULTY_BONUS.hard))
})

test('a fast win earns no time bonus', () => {
  const quick = { ...newSudoku('easy', seeded(16)), score: 100, startedAt: 0, wonAt: 20_000 }
  assert.equal(timeBonus(quick), 0)
})
