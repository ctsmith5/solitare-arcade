import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CELLS,
  EMPTY,
  GIVENS_BANDS,
  MIN_GIVENS,
  boxOf,
  candidatesAt,
  colOf,
  conflictsAt,
  countSolutions,
  findConflicts,
  generate,
  hint,
  isComplete,
  isSolved,
  peersOf,
  rowOf,
  solve,
} from './sudoku.ts'
import type { Cell, Digit, Grid, SudokuDifficulty } from './sudoku.ts'

/** Deterministic RNG so every puzzle in these tests is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const DIFFICULTIES: SudokuDifficulty[] = ['easy', 'medium', 'hard']

const emptyGrid = (): Grid => new Array<Cell>(CELLS).fill(EMPTY)

/** Reads a grid from a picture; `.` or `0` is blank, everything else ignored. */
function fromString(text: string): Grid {
  const digits = text.replace(/[^0-9.]/g, '')
  assert.equal(digits.length, CELLS, 'fixture must have 81 cells')
  return [...digits].map((ch) => (ch === '.' ? EMPTY : (Number(ch) as Cell)))
}

const givensOf = (grid: Grid): number => grid.filter((c) => c !== EMPTY).length

/** The classic Wikipedia example — a well-known, uniquely solvable puzzle. */
const WIKI_PUZZLE = fromString(`
  53. .7. ...
  6.. 195 ...
  .98 ... .6.
  8.. .6. ..3
  4.. 8.3 ..1
  7.. .2. ..6
  .6. ... 28.
  ... 419 ..5
  ... .8. .79
`)

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

test('rowOf / colOf / boxOf address the grid row-major', () => {
  assert.equal(rowOf(0), 0)
  assert.equal(colOf(0), 0)
  assert.equal(boxOf(0), 0)

  assert.equal(rowOf(80), 8)
  assert.equal(colOf(80), 8)
  assert.equal(boxOf(80), 8)

  assert.equal(rowOf(30), 3)
  assert.equal(colOf(30), 3)
  assert.equal(boxOf(30), 4)

  for (let i = 0; i < CELLS; i++) {
    assert.ok(rowOf(i) >= 0 && rowOf(i) < 9)
    assert.ok(colOf(i) >= 0 && colOf(i) < 9)
    assert.ok(boxOf(i) >= 0 && boxOf(i) < 9)
    assert.equal(i, rowOf(i) * 9 + colOf(i))
  }
})

test('peersOf(0) is exactly the 20 cells sharing its row, column or box', () => {
  const peers = peersOf(0)
  assert.equal(peers.length, 20)
  assert.equal(new Set(peers).size, 20)

  assert.ok(!peers.includes(0))
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(peers.includes(i), `row cell ${i}`)
  for (const i of [9, 18, 27, 36, 45, 54, 63, 72]) assert.ok(peers.includes(i), `col cell ${i}`)
  for (const i of [10, 11, 19, 20]) assert.ok(peers.includes(i), `box cell ${i}`)
  for (const i of [12, 21, 80]) assert.ok(!peers.includes(i), `unrelated cell ${i}`)
})

test('every cell has 20 peers, the relation is symmetric, and the table is not shared', () => {
  for (let i = 0; i < CELLS; i++) {
    const peers = peersOf(i)
    assert.equal(peers.length, 20, `cell ${i}`)
    for (const p of peers) assert.ok(peersOf(p).includes(i), `${i} <-> ${p}`)
  }

  const stolen = peersOf(40)
  stolen[0] = -1
  assert.ok(!peersOf(40).includes(-1))
})

/* ------------------------------------------------------------------ *
 * Inspection
 * ------------------------------------------------------------------ */

test('isComplete / isSolved separate "full" from "correct"', () => {
  assert.equal(isComplete(emptyGrid()), false)
  assert.equal(isSolved(emptyGrid()), false)

  const solution = solve(WIKI_PUZZLE)
  assert.ok(solution)
  assert.equal(isComplete(solution), true)
  assert.equal(isSolved(solution), true)

  assert.equal(isComplete(WIKI_PUZZLE), false)
  assert.equal(isSolved(WIKI_PUZZLE), false)

  // Full but wrong: duplicate a digit inside a row.
  const broken = solution.slice()
  broken[1] = broken[0]
  assert.equal(isComplete(broken), true)
  assert.equal(isSolved(broken), false)
})

test('conflictsAt and findConflicts catch a row, column and box duplicate', () => {
  const row = emptyGrid()
  row[0] = 5
  row[8] = 5
  assert.equal(conflictsAt(row, 0), true)
  assert.equal(conflictsAt(row, 8), true)
  assert.equal(conflictsAt(row, 4), false, 'blank cells never clash')
  assert.deepEqual(findConflicts(row), new Set([0, 8]))

  const col = emptyGrid()
  col[4] = 7
  col[76] = 7
  assert.equal(conflictsAt(col, 4), true)
  assert.deepEqual(findConflicts(col), new Set([4, 76]))

  const box = emptyGrid()
  box[30] = 3 // row 3, col 3
  box[41] = 3 // row 4, col 5 — same box, but neither row nor column overlaps
  assert.notEqual(rowOf(30), rowOf(41))
  assert.notEqual(colOf(30), colOf(41))
  assert.equal(boxOf(30), boxOf(41))
  assert.equal(conflictsAt(box, 30), true)
  assert.deepEqual(findConflicts(box), new Set([30, 41]))

  const clean = solve(WIKI_PUZZLE)
  assert.ok(clean)
  assert.equal(findConflicts(clean).size, 0)
})

test('candidatesAt lists legal digits for blanks only', () => {
  const solution = solve(WIKI_PUZZLE)
  assert.ok(solution)

  assert.deepEqual(candidatesAt(solution, 0), [], 'a filled cell has no candidates')

  const oneBlank = solution.slice()
  const answer = oneBlank[40]
  oneBlank[40] = EMPTY
  assert.deepEqual(candidatesAt(oneBlank, 40), [answer])

  assert.deepEqual(candidatesAt(emptyGrid(), 0), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

/* ------------------------------------------------------------------ *
 * Solver
 * ------------------------------------------------------------------ */

test('solve returns a valid solution and does not mutate its argument', () => {
  const input = WIKI_PUZZLE.slice()
  Object.freeze(input)

  const solution = solve(input)
  assert.ok(solution)
  assert.equal(isSolved(solution), true)
  assert.deepEqual(input, WIKI_PUZZLE, 'input untouched')

  // The solution has to agree with every given.
  for (let i = 0; i < CELLS; i++) {
    if (input[i] !== EMPTY) assert.equal(solution[i], input[i])
  }
})

test('solve returns null when the grid cannot be completed', () => {
  const duplicate = emptyGrid()
  duplicate[0] = 5
  duplicate[1] = 5
  assert.equal(solve(duplicate), null)

  // Consistent givens, but cell 0 is left with no legal digit.
  const starved = emptyGrid()
  const row = [1, 2, 3, 4] as Digit[]
  row.forEach((d, k) => (starved[1 + k] = d)) // row 0: cols 1-4
  const col = [5, 6, 7, 8] as Digit[]
  col.forEach((d, k) => (starved[(k + 3) * 9] = d)) // col 0: rows 3-6
  starved[10] = 9 // same box as cell 0
  assert.equal(candidatesAt(starved, 0).length, 0)
  assert.equal(solve(starved), null)
})

test('countSolutions counts, and stops at the limit', () => {
  assert.equal(countSolutions(WIKI_PUZZLE, 2), 1)

  const contradictory = emptyGrid()
  contradictory[0] = 4
  contradictory[9] = 4
  assert.equal(countSolutions(contradictory, 2), 0)

  const starved = emptyGrid()
  ;([1, 2, 3, 4, 5, 6, 7, 8] as Digit[]).forEach((d, k) => (starved[1 + k] = d))
  starved[9] = 9 // the last digit row 0 needed is now blocked in column 0
  assert.equal(countSolutions(starved, 2), 0)

  assert.equal(countSolutions(emptyGrid()), 2, 'default limit is 2')
  assert.equal(countSolutions(emptyGrid(), 5), 5)
  assert.equal(countSolutions(emptyGrid(), 1), 1)
  assert.equal(countSolutions(emptyGrid(), 0), 0)

  // Blank a whole band: its three rows can be permuted freely and every
  // constraint still holds, so this is provably ambiguous.
  const solution = solve(WIKI_PUZZLE)
  assert.ok(solution)
  const underConstrained = solution.slice()
  for (let i = 0; i < 27; i++) underConstrained[i] = EMPTY
  assert.equal(countSolutions(underConstrained, 2), 2)
})

test('the solver handles puzzles built to defeat naive backtracking', () => {
  // Inkala's 2012 "hardest Sudoku" — 21 clues, unique, notoriously deep search.
  const brutal = fromString(`
    8.. ... ...
    ..3 6.. ...
    .7. .9. 2..
    .5. ..7 ...
    ... .45 7..
    ... 1.. .3.
    ..1 ... .68
    ..8 5.. .1.
    .9. ... 4..
  `)

  const started = Date.now()
  const solution = solve(brutal)
  const elapsed = Date.now() - started

  assert.ok(solution)
  assert.equal(isSolved(solution), true)
  for (let i = 0; i < CELLS; i++) {
    if (brutal[i] !== EMPTY) assert.equal(solution[i], brutal[i], `cell ${i}`)
  }
  assert.equal(countSolutions(brutal, 2), 1)
  assert.ok(elapsed < 1000, `solve took ${elapsed}ms`)
})

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

function assertValidSolution(solution: Grid): void {
  assert.equal(solution.length, CELLS)
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9]

  for (let unit = 0; unit < 9; unit++) {
    const row: Cell[] = []
    const col: Cell[] = []
    const box: Cell[] = []
    for (let i = 0; i < CELLS; i++) {
      if (rowOf(i) === unit) row.push(solution[i])
      if (colOf(i) === unit) col.push(solution[i])
      if (boxOf(i) === unit) box.push(solution[i])
    }
    assert.deepEqual([...row].sort(), [...expected].sort(), `row ${unit}`)
    assert.deepEqual([...col].sort(), [...expected].sort(), `column ${unit}`)
    assert.deepEqual([...box].sort(), [...expected].sort(), `box ${unit}`)
  }
}

test('difficulty bands are the documented ones and stay above the 17-clue floor', () => {
  assert.deepEqual(GIVENS_BANDS.easy, [36, 45])
  assert.deepEqual(GIVENS_BANDS.medium, [30, 35])
  assert.deepEqual(GIVENS_BANDS.hard, [25, 29])
  assert.equal(MIN_GIVENS, 17)
  for (const difficulty of DIFFICULTIES) {
    assert.ok(GIVENS_BANDS[difficulty][0] >= MIN_GIVENS, difficulty)
  }
})

for (const difficulty of DIFFICULTIES) {
  test(`generate('${difficulty}') yields a uniquely solvable puzzle across seeds`, () => {
    const [low, high] = GIVENS_BANDS[difficulty]

    for (const seed of [1, 2, 3, 17, 424242]) {
      const { puzzle, solution, givens, difficulty: tag } = generate(difficulty, seeded(seed))

      assert.equal(tag, difficulty)
      assert.equal(puzzle.length, CELLS)
      assert.equal(solution.length, CELLS)

      assert.equal(givens, givensOf(puzzle), `seed ${seed}: givens field matches the grid`)
      assert.ok(givens >= MIN_GIVENS, `seed ${seed}: ${givens} givens is below the proven floor`)
      assert.ok(givens >= low && givens <= high, `seed ${seed}: ${givens} outside ${low}-${high}`)

      assertValidSolution(solution)
      assert.equal(isSolved(solution), true)

      // The puzzle is the solution with holes — never a different grid.
      for (let i = 0; i < CELLS; i++) {
        if (puzzle[i] !== EMPTY) assert.equal(puzzle[i], solution[i], `seed ${seed}: cell ${i}`)
      }

      assert.deepEqual(solve(puzzle), solution, `seed ${seed}: solve recovers the solution`)
      assert.equal(countSolutions(puzzle, 2), 1, `seed ${seed}: solution must be unique`)
    }
  })
}

test('generation is seedable: same seed, same puzzle; different seeds differ', () => {
  for (const difficulty of DIFFICULTIES) {
    const a = generate(difficulty, seeded(99))
    const b = generate(difficulty, seeded(99))
    assert.deepEqual(a, b, `${difficulty} is reproducible`)

    const c = generate(difficulty, seeded(100))
    assert.notDeepEqual(a.puzzle, c.puzzle, `${difficulty} varies with the seed`)
    assert.notDeepEqual(a.solution, c.solution)
  }
})

test('puzzle and solution are independent arrays', () => {
  const { puzzle, solution } = generate('medium', seeded(5))
  const before = solution.slice()
  puzzle.fill(EMPTY)
  assert.deepEqual(solution, before)
})

/* ------------------------------------------------------------------ *
 * Hints
 * ------------------------------------------------------------------ */

test('hint points at the most constrained blank and knows the right digit', () => {
  const { puzzle, solution } = generate('hard', seeded(11))

  const index = hint(puzzle, solution)
  assert.ok(index !== null)
  assert.equal(puzzle[index], EMPTY, 'hints are only ever blank cells')

  const blanks: number[] = []
  for (let i = 0; i < CELLS; i++) if (puzzle[i] === EMPTY) blanks.push(i)
  const fewest = Math.min(...blanks.map((i) => candidatesAt(puzzle, i).length))
  assert.equal(candidatesAt(puzzle, index).length, fewest, 'most constrained cell wins')

  // Taking the hint keeps the puzzle correct and still unique.
  const filled = puzzle.slice()
  filled[index] = solution[index]
  assert.equal(findConflicts(filled).size, 0)
  assert.equal(countSolutions(filled, 2), 1)
  assert.deepEqual(solve(filled), solution)
})

test('hint returns null once the grid is complete', () => {
  const { solution } = generate('easy', seeded(3))
  assert.equal(hint(solution, solution), null)
})

test('hint skips a cell whose answer a wrong entry has already ruled out', () => {
  const { solution } = generate('easy', seeded(8))

  const grid = solution.slice()
  const answer = grid[0]
  grid[0] = EMPTY
  grid[40] = EMPTY
  grid[1] = answer // a peer now holds cell 0's digit, so cell 0 has no candidates

  assert.equal(candidatesAt(grid, 0).length, 0)
  assert.equal(hint(grid, solution), 40)
})

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

test('generating a hard puzzle stays fast', () => {
  const started = Date.now()
  const { puzzle } = generate('hard', seeded(2024))
  const elapsed = Date.now() - started

  assert.equal(countSolutions(puzzle, 2), 1)
  assert.ok(elapsed < 2000, `generate('hard') took ${elapsed}ms`)
})
