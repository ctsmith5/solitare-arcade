/*
 * Sudoku engine — pure functions over a flat, row-major, 81-cell grid.
 *
 * No imports, no framework, no mutation of arguments: `node --test` loads this
 * module directly and the React layer can treat every grid as immutable state.
 */

export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type Cell = Digit | 0
export type Grid = Cell[]
export type SudokuDifficulty = 'easy' | 'medium' | 'hard'

export interface Puzzle {
  puzzle: Grid
  solution: Grid
  difficulty: SudokuDifficulty
  givens: number
}

export const EMPTY: Cell = 0
export const CELLS = 81

/** No Sudoku with fewer than 17 givens has a unique solution — proven, 2012. */
export const MIN_GIVENS = 17

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export function rowOf(i: number): number {
  return (i / 9) | 0
}

export function colOf(i: number): number {
  return i % 9
}

export function boxOf(i: number): number {
  return ((i / 27) | 0) * 3 + (((i % 9) / 3) | 0)
}

// Lookup tables: the solver touches these millions of times per generate().
const ROW = new Int8Array(CELLS)
const COL = new Int8Array(CELLS)
const BOX = new Int8Array(CELLS)
for (let i = 0; i < CELLS; i++) {
  ROW[i] = rowOf(i)
  COL[i] = colOf(i)
  BOX[i] = boxOf(i)
}

const PEERS: number[][] = []
for (let i = 0; i < CELLS; i++) {
  const peers: number[] = []
  for (let j = 0; j < CELLS; j++) {
    if (j === i) continue
    if (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i]) peers.push(j)
  }
  PEERS.push(peers)
}

/** The 20 cells sharing a row, column or box — a copy, so callers can't poison the table. */
export function peersOf(index: number): number[] {
  return PEERS[index].slice()
}

/* ------------------------------------------------------------------ *
 * Bitmask helpers — bit d-1 set means digit d is taken.
 * ------------------------------------------------------------------ */

const ALL_DIGITS = 0b111111111

const POPCOUNT = new Int8Array(ALL_DIGITS + 1)
for (let m = 1; m <= ALL_DIGITS; m++) POPCOUNT[m] = POPCOUNT[m >> 1] + (m & 1)

function digitsOf(mask: number): Digit[] {
  const out: Digit[] = []
  for (let d = 1; d <= 9; d++) {
    if (mask & (1 << (d - 1))) out.push(d as Digit)
  }
  return out
}

/** Fisher-Yates, in place — only ever called on scratch arrays. */
function shuffleInto<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/* ------------------------------------------------------------------ *
 * Inspection
 * ------------------------------------------------------------------ */

export function isComplete(grid: Grid): boolean {
  if (grid.length !== CELLS) return false
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] === EMPTY) return false
  }
  return true
}

/** Does the value at `index` clash with a peer? Blank cells never clash. */
export function conflictsAt(grid: Grid, index: number): boolean {
  const value = grid[index]
  if (!value) return false
  for (const peer of PEERS[index]) {
    if (grid[peer] === value) return true
  }
  return false
}

/** Every index involved in a clash — both halves of each duplicate pair. */
export function findConflicts(grid: Grid): Set<number> {
  const clashing = new Set<number>()
  for (let i = 0; i < CELLS; i++) {
    const value = grid[i]
    if (!value) continue
    for (const peer of PEERS[i]) {
      if (grid[peer] === value) {
        clashing.add(i)
        clashing.add(peer)
      }
    }
  }
  return clashing
}

export function isSolved(grid: Grid): boolean {
  return isComplete(grid) && findConflicts(grid).size === 0
}

/** The digits that would be legal in a blank cell; a filled cell has none. */
export function candidatesAt(grid: Grid, index: number): Digit[] {
  if (grid[index] !== EMPTY) return []
  let mask = ALL_DIGITS
  for (const peer of PEERS[index]) {
    const value = grid[peer]
    if (value) mask &= ~(1 << (value - 1))
  }
  return digitsOf(mask)
}

/* ------------------------------------------------------------------ *
 * Solver
 *
 * Candidates live in three bitmask arrays (row/column/box) that are updated
 * incrementally, so a placement costs three ORs instead of a peer rescan.
 * Branching always picks the most-constrained blank, which keeps the search
 * tree shallow enough that `countSolutions` on a near-complete grid is
 * effectively instant.
 * ------------------------------------------------------------------ */

interface Solver {
  cells: Int8Array
  rowMask: Int32Array
  colMask: Int32Array
  boxMask: Int32Array
  first: Int8Array | null
  /** When set, digits are tried in random order — that's what makes generation varied. */
  rng: (() => number) | null
}

/** Loads a grid into masks. Returns null when the givens already contradict. */
function prepare(grid: Grid, rng: (() => number) | null): Solver | null {
  const solver: Solver = {
    cells: new Int8Array(CELLS),
    rowMask: new Int32Array(9),
    colMask: new Int32Array(9),
    boxMask: new Int32Array(9),
    first: null,
    rng,
  }

  for (let i = 0; i < CELLS; i++) {
    const value = grid[i]
    if (!value) continue
    const bit = 1 << (value - 1)
    const r = ROW[i]
    const c = COL[i]
    const b = BOX[i]
    if ((solver.rowMask[r] | solver.colMask[c] | solver.boxMask[b]) & bit) return null
    solver.rowMask[r] |= bit
    solver.colMask[c] |= bit
    solver.boxMask[b] |= bit
    solver.cells[i] = value
  }
  return solver
}

/** Solutions reachable from here, counting no further than `limit`. */
function search(solver: Solver, limit: number): number {
  if (limit <= 0) return 0

  let target = -1
  let targetMask = 0
  let fewest = 10

  for (let i = 0; i < CELLS; i++) {
    if (solver.cells[i] !== 0) continue
    const mask =
      ALL_DIGITS & ~(solver.rowMask[ROW[i]] | solver.colMask[COL[i]] | solver.boxMask[BOX[i]])
    if (mask === 0) return 0 // a blank with nowhere to go kills the branch outright
    const count = POPCOUNT[mask]
    if (count < fewest) {
      fewest = count
      target = i
      targetMask = mask
      if (count === 1) break
    }
  }

  if (target < 0) {
    if (!solver.first) solver.first = solver.cells.slice()
    return 1
  }

  const digits = digitsOf(targetMask)
  if (solver.rng) shuffleInto(digits, solver.rng)

  const r = ROW[target]
  const c = COL[target]
  const b = BOX[target]
  let found = 0

  for (const digit of digits) {
    const bit = 1 << (digit - 1)
    solver.cells[target] = digit
    solver.rowMask[r] |= bit
    solver.colMask[c] |= bit
    solver.boxMask[b] |= bit

    found += search(solver, limit - found)

    solver.rowMask[r] &= ~bit
    solver.colMask[c] &= ~bit
    solver.boxMask[b] &= ~bit
    solver.cells[target] = 0

    if (found >= limit) break
  }

  return found
}

function toGrid(cells: Int8Array): Grid {
  return Array.from(cells, (value) => value as Cell)
}

/** The first solution found, or null. Never touches `grid`. */
export function solve(grid: Grid): Grid | null {
  const solver = prepare(grid, null)
  if (!solver) return null
  if (search(solver, 1) === 0 || !solver.first) return null
  return toGrid(solver.first)
}

/** How many solutions the grid admits, stopping the count at `limit`. */
export function countSolutions(grid: Grid, limit = 2): number {
  if (limit <= 0) return 0
  const solver = prepare(grid, null)
  if (!solver) return 0
  return search(solver, limit)
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Givens that survive removal is the only difficulty knob here: fewer clues
 * means more of the grid has to be deduced. Random digging bottoms out around
 * 22-27 clues, so the hard band sits just above that floor.
 */
export const GIVENS_BANDS: Record<SudokuDifficulty, [number, number]> = {
  easy: [36, 45],
  medium: [30, 35],
  hard: [25, 29],
}

/** A complete, valid grid, built by backtracking with randomised digit order. */
function fullGrid(rng: () => number): Grid {
  const solver = prepare(new Array<Cell>(CELLS).fill(EMPTY), rng)
  // An empty grid can't contradict, and every empty grid is completable.
  search(solver!, 1)
  return toGrid(solver!.first!)
}

/**
 * Removes clues one at a time in random order, keeping a removal only while the
 * puzzle still has exactly one solution. Removing a clue can never make a
 * previously-unremovable clue removable, so a single pass is exhaustive.
 */
function carve(solution: Grid, target: number, rng: () => number): Grid {
  const puzzle = solution.slice()
  const order = shuffleInto(
    Array.from({ length: CELLS }, (_, i) => i),
    rng,
  )

  let givens = CELLS
  for (const i of order) {
    if (givens <= target) break
    const removed = puzzle[i]
    puzzle[i] = EMPTY
    if (countSolutions(puzzle, 2) === 1) givens--
    else puzzle[i] = removed
  }
  return puzzle
}

function countGivens(grid: Grid): number {
  let n = 0
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== EMPTY) n++
  }
  return n
}

/**
 * A puzzle with exactly one solution, in the requested difficulty band.
 *
 * Every random choice runs through `rng`, so a seeded generator reproduces a
 * puzzle exactly. Digging stops at a random target inside the band; if a grid
 * refuses to dig that deep the whole attempt is thrown away and retried, and
 * the closest candidate is the fallback so this always returns something
 * playable rather than looping.
 */
export function generate(difficulty: SudokuDifficulty, rng: () => number = Math.random): Puzzle {
  const [low, high] = GIVENS_BANDS[difficulty]
  const target = Math.max(MIN_GIVENS, low)

  let best: Puzzle | null = null

  for (let attempt = 0; attempt < 8; attempt++) {
    const solution = fullGrid(rng)
    const wanted = target + Math.floor(rng() * (high - target + 1))
    const puzzle = carve(solution, wanted, rng)
    const candidate: Puzzle = { puzzle, solution, difficulty, givens: countGivens(puzzle) }

    if (candidate.givens <= high) return candidate
    if (!best || candidate.givens < best.givens) best = candidate
  }

  return best as Puzzle
}

/* ------------------------------------------------------------------ *
 * Hints
 * ------------------------------------------------------------------ */

/**
 * The blank worth revealing next: fewest candidates, so the player can see why
 * it works. Cells whose answer a wrong entry has already ruled out are
 * deprioritised — pointing at one would look like the engine contradicting
 * itself. Null once nothing is blank.
 */
export function hint(grid: Grid, solution: Grid): number | null {
  let best: number | null = null
  let bestScore = Infinity

  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== EMPTY) continue
    const options = candidatesAt(grid, i)
    const blocked = options.includes(solution[i] as Digit) ? 0 : 100
    const score = blocked + options.length
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }

  return best
}
