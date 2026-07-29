// Extensions are explicit, and types imported with `import type`, so that
// `node --test` can load these modules directly without a bundler.
import type { Card, Difficulty, GameState, PileId, Rank, Suit } from './types.ts'
import { SUITS, SUIT_COLOR } from './types.ts'

export type { Difficulty } from './types.ts'

/* ------------------------------------------------------------------ *
 * Scoring — the classic Klondike table.
 * ------------------------------------------------------------------ */
export const SCORE = {
  wasteToTableau: 5,
  wasteToFoundation: 10,
  tableauToFoundation: 10,
  turnOverTableauCard: 5,
  foundationToTableau: -15,
  recycleWaste: -100,
} as const

/* ------------------------------------------------------------------ *
 * Deck
 * ------------------------------------------------------------------ */

export function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: `${suit}-${rank}`, suit, rank: rank as Rank, faceUp: false })
    }
  }
  return deck
}

/** Fisher-Yates. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Deals a fresh game: 1..7 cards per column, top of each column face up. */
export function newGame(rng: () => number = Math.random): GameState {
  const deck = shuffle(buildDeck(), rng)
  const tableau: Card[][] = [[], [], [], [], [], [], []]

  let next = 0
  for (let col = 0; col < 7; col++) {
    for (let row = col; row < 7; row++) {
      tableau[row].push(deck[next++])
    }
  }
  for (const column of tableau) {
    column[column.length - 1].faceUp = true
  }

  return {
    difficulty: 'medium',
    stock: deck.slice(next),
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    score: 0,
    moves: 0,
    passes: 0,
    startedAt: Date.now(),
    wonAt: null,
  }
}

/* ------------------------------------------------------------------ *
 * Pile access
 * ------------------------------------------------------------------ */

export function getPile(state: GameState, pile: PileId): Card[] {
  switch (pile.kind) {
    case 'stock':
      return state.stock
    case 'waste':
      return state.waste
    case 'foundation':
      return state.foundations[pile.index]
    case 'tableau':
      return state.tableau[pile.index]
  }
}

export const samePile = (a: PileId, b: PileId): boolean =>
  a.kind === b.kind &&
  ('index' in a ? a.index : -1) === ('index' in b ? b.index : -1)

const clone = (state: GameState): GameState => ({
  ...state,
  stock: state.stock.slice(),
  waste: state.waste.slice(),
  foundations: state.foundations.map((f) => f.slice()),
  tableau: state.tableau.map((t) => t.slice()),
})

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/** Foundations are suit-locked slots: index i only ever holds SUITS[i]. */
export function canPlaceOnFoundation(card: Card, foundationIndex: number, state: GameState): boolean {
  const suit: Suit = SUITS[foundationIndex]
  if (card.suit !== suit) return false
  const pile = state.foundations[foundationIndex]
  if (pile.length === 0) return card.rank === 1
  return card.rank === pile[pile.length - 1].rank + 1
}

/** Tableau builds down in alternating colours; empty columns take a King. */
export function canPlaceOnTableau(card: Card, tableauIndex: number, state: GameState): boolean {
  const pile = state.tableau[tableauIndex]
  if (pile.length === 0) return card.rank === 13
  const top = pile[pile.length - 1]
  if (!top.faceUp) return false
  return SUIT_COLOR[top.suit] !== SUIT_COLOR[card.suit] && card.rank === top.rank - 1
}

/** A run may be dragged only if it descends by one in alternating colours. */
export function isValidRun(cards: Card[]): boolean {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].faceUp) return false
    if (i > 0) {
      const prev = cards[i - 1]
      const cur = cards[i]
      if (cur.rank !== prev.rank - 1) return false
      if (SUIT_COLOR[cur.suit] === SUIT_COLOR[prev.suit]) return false
    }
  }
  return cards.length > 0
}

/**
 * The cards that would travel if the player grabbed `index` of `pile`.
 * Returns null when that grab isn't legal.
 */
export function grabbableCards(state: GameState, pile: PileId, index: number): Card[] | null {
  const cards = getPile(state, pile)
  if (index < 0 || index >= cards.length) return null

  switch (pile.kind) {
    case 'stock':
      return null
    case 'waste':
    case 'foundation':
      // Only the exposed top card can leave these piles.
      if (index !== cards.length - 1) return null
      return [cards[index]]
    case 'tableau': {
      const run = cards.slice(index)
      return isValidRun(run) ? run : null
    }
  }
}

export function canDrop(state: GameState, cards: Card[], to: PileId): boolean {
  if (cards.length === 0) return false
  switch (to.kind) {
    case 'stock':
      return false
    case 'waste':
      return false
    case 'foundation':
      // Foundations accept a single card at a time.
      return cards.length === 1 && canPlaceOnFoundation(cards[0], to.index, state)
    case 'tableau':
      return isValidRun(cards) && canPlaceOnTableau(cards[0], to.index, state)
  }
}

/* ------------------------------------------------------------------ *
 * Moves — every one returns a new state, or null if illegal.
 * ------------------------------------------------------------------ */

function scoreForMove(from: PileId, to: PileId): number {
  if (to.kind === 'foundation') {
    if (from.kind === 'waste') return SCORE.wasteToFoundation
    if (from.kind === 'tableau') return SCORE.tableauToFoundation
    return 0
  }
  if (to.kind === 'tableau') {
    if (from.kind === 'waste') return SCORE.wasteToTableau
    if (from.kind === 'foundation') return SCORE.foundationToTableau
  }
  return 0
}

export function moveCards(
  state: GameState,
  from: PileId,
  fromIndex: number,
  to: PileId,
): GameState | null {
  if (samePile(from, to)) return null

  const moving = grabbableCards(state, from, fromIndex)
  if (!moving || !canDrop(state, moving, to)) return null

  const next = clone(state)
  const source = getPile(next, from)
  const target = getPile(next, to)

  source.splice(fromIndex, moving.length)
  target.push(...moving)

  let delta = scoreForMove(from, to)

  // Uncovering a face-down tableau card flips it and pays out.
  if (from.kind === 'tableau' && source.length > 0) {
    const exposed = source[source.length - 1]
    if (!exposed.faceUp) {
      source[source.length - 1] = { ...exposed, faceUp: true }
      delta += SCORE.turnOverTableauCard
    }
  }

  next.score = Math.max(0, next.score + delta)
  next.moves += 1
  return finalize(next)
}

/** Draw one card from the stock; recycles the waste when the stock is out. */
export function drawFromStock(state: GameState): GameState | null {
  const next = clone(state)

  if (next.stock.length > 0) {
    const card = next.stock.pop()!
    next.waste.push({ ...card, faceUp: true })
    next.moves += 1
    return finalize(next)
  }

  if (next.waste.length === 0) return null

  // Recycle: the waste flips back under the stock in its original order.
  next.stock = next.waste
    .slice()
    .reverse()
    .map((c) => ({ ...c, faceUp: false }))
  next.waste = []
  next.passes += 1
  next.score = Math.max(0, next.score + SCORE.recycleWaste)
  next.moves += 1
  return finalize(next)
}

/**
 * Sends a card straight to its foundation — the double-click shortcut.
 */
export function sendToFoundation(state: GameState, from: PileId, index: number): GameState | null {
  const cards = getPile(state, from)
  if (index !== cards.length - 1) return null
  const card = cards[index]
  if (!card?.faceUp) return null

  const foundationIndex = SUITS.indexOf(card.suit)
  if (!canPlaceOnFoundation(card, foundationIndex, state)) return null
  return moveCards(state, from, index, { kind: 'foundation', index: foundationIndex })
}

/** The best legal destination for a card the player clicked once. */
export function findAutoMove(state: GameState, from: PileId, index: number): PileId | null {
  const moving = grabbableCards(state, from, index)
  if (!moving) return null

  if (moving.length === 1) {
    const foundationIndex = SUITS.indexOf(moving[0].suit)
    if (from.kind !== 'foundation' && canPlaceOnFoundation(moving[0], foundationIndex, state)) {
      return { kind: 'foundation', index: foundationIndex }
    }
  }

  // Prefer a non-empty column so we don't waste an empty slot on a King.
  const columns = state.tableau
    .map((pile, i) => ({ pile, i }))
    .sort((a, b) => Number(a.pile.length === 0) - Number(b.pile.length === 0))

  for (const { pile, i } of columns) {
    if (from.kind === 'tableau' && from.index === i) continue
    // Moving a whole column onto an empty one achieves nothing.
    if (pile.length === 0 && from.kind === 'tableau' && index === 0) continue
    if (canPlaceOnTableau(moving[0], i, state)) return { kind: 'tableau', index: i }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Auto-finish
 * ------------------------------------------------------------------ */

/** True once no card is face down and the stock/waste are exhausted. */
export function canAutoComplete(state: GameState): boolean {
  if (state.wonAt) return false
  if (state.stock.length > 0 || state.waste.length > 0) return false
  return state.tableau.every((pile) => pile.every((card) => card.faceUp))
}

/** One step of the auto-finish animation; null when there's nothing left. */
export function autoCompleteStep(state: GameState): GameState | null {
  for (let i = 0; i < state.tableau.length; i++) {
    const pile = state.tableau[i]
    if (pile.length === 0) continue
    const next = sendToFoundation(state, { kind: 'tableau', index: i }, pile.length - 1)
    if (next) return next
  }
  return null
}

export const isWon = (state: GameState): boolean =>
  state.foundations.every((pile) => pile.length === 13)

/* ------------------------------------------------------------------ *
 * Dead ends
 * ------------------------------------------------------------------ */

export interface Move {
  from: PileId
  fromIndex: number
  to: PileId
  cards: Card[]
  /**
   * True when the move changes what the player can reach — it banks a card,
   * uncovers a face-down one, or frees a column. Sliding a run between two
   * columns without uncovering anything is legal but gets you nowhere.
   */
  productive: boolean
}

/** Tableau runs that have a legal home on a foundation or another column. */
function tableauMoves(state: GameState): Move[] {
  const moves: Move[] = []

  state.tableau.forEach((pile, i) => {
    for (let index = 0; index < pile.length; index++) {
      const from: PileId = { kind: 'tableau', index: i }
      const cards = grabbableCards(state, from, index)
      if (!cards) continue

      if (cards.length === 1) {
        const f = SUITS.indexOf(cards[0].suit)
        if (canPlaceOnFoundation(cards[0], f, state)) {
          moves.push({ from, fromIndex: index, to: { kind: 'foundation', index: f }, cards, productive: true })
        }
      }

      for (let target = 0; target < state.tableau.length; target++) {
        if (target === i) continue
        if (!canPlaceOnTableau(cards[0], target, state)) continue

        const uncoversCard = index > 0 && !pile[index - 1].faceUp
        const emptiesColumn = index === 0
        const targetEmpty = state.tableau[target].length === 0
        moves.push({
          from,
          fromIndex: index,
          to: { kind: 'tableau', index: target },
          cards,
          // Relocating a whole column onto an empty one achieves nothing.
          productive: uncoversCard || (emptiesColumn && !targetEmpty),
        })
      }
    }
  })

  return moves
}

/** Whatever the exposed waste card can do right now. */
function wasteMoves(state: GameState): Move[] {
  const moves: Move[] = []
  if (state.waste.length === 0) return moves

  const index = state.waste.length - 1
  const card = state.waste[index]
  const from: PileId = { kind: 'waste' }

  const f = SUITS.indexOf(card.suit)
  if (canPlaceOnFoundation(card, f, state)) {
    moves.push({ from, fromIndex: index, to: { kind: 'foundation', index: f }, cards: [card], productive: true })
  }
  for (let target = 0; target < state.tableau.length; target++) {
    if (canPlaceOnTableau(card, target, state)) {
      moves.push({ from, fromIndex: index, to: { kind: 'tableau', index: target }, cards: [card], productive: true })
    }
  }
  return moves
}

/** Pulling a card back off a foundation — legal, but rarely progress by itself. */
function foundationMoves(state: GameState): Move[] {
  const moves: Move[] = []

  state.foundations.forEach((pile, index) => {
    if (pile.length === 0) return
    const card = pile[pile.length - 1]
    const from: PileId = { kind: 'foundation', index }
    for (let target = 0; target < state.tableau.length; target++) {
      if (canPlaceOnTableau(card, target, state)) {
        moves.push({ from, fromIndex: pile.length - 1, to: { kind: 'tableau', index: target }, cards: [card], productive: false })
      }
    }
  })

  return moves
}

/** Every move playable from the board as it stands, ignoring the stock. */
export function findAllMoves(state: GameState): Move[] {
  if (state.wonAt) return []
  return [...tableauMoves(state), ...wasteMoves(state), ...foundationMoves(state)]
}

/**
 * A card still circulating in the stock that has somewhere legal to land.
 *
 * Draw-one with unlimited redeals means every stock and waste card reaches the
 * top of the waste sooner or later, so the whole set can be tested directly
 * instead of simulating passes. Cycling never changes the tableau, so a card
 * that fits nowhere now will not fit later either.
 */
export function findStockMove(state: GameState): { card: Card; to: PileId } | null {
  for (const card of [...state.stock, ...state.waste]) {
    const f = SUITS.indexOf(card.suit)
    if (canPlaceOnFoundation(card, f, state)) return { card, to: { kind: 'foundation', index: f } }
    for (let target = 0; target < state.tableau.length; target++) {
      if (canPlaceOnTableau(card, target, state)) return { card, to: { kind: 'tableau', index: target } }
    }
  }
  return null
}

/**
 * True when the game is over: not one legal move remains, now or after any
 * number of trips through the stock. This is exact — if it reports a dead end
 * there is genuinely nothing the player could have done.
 */
export function isDeadEnd(state: GameState): boolean {
  if (state.wonAt) return false
  if (findAllMoves(state).length > 0) return false
  return findStockMove(state) === null
}

/**
 * Whether any move actually advances the game. Legal-but-pointless shuffles —
 * a black jack bouncing between two red queens, a lone king hopping between
 * empty columns — do not count.
 *
 * Unlike isDeadEnd this is a heuristic: it answers "is there progress on the
 * next move", not "is this deal still winnable". Deciding the latter needs a
 * full search, so a false here is a strong hint rather than a proof.
 */
export function hasProductiveMove(state: GameState): boolean {
  if (state.wonAt) return false
  if (findAllMoves(state).some((move) => move.productive)) return true
  if (findStockMove(state)) return true

  // Last resort: does taking a card back off a foundation unblock anything?
  for (const pull of foundationMoves(state)) {
    const next = moveCards(state, pull.from, pull.fromIndex, pull.to)
    if (!next) continue
    if (tableauMoves(next).some((m) => m.productive)) return true
    if (wasteMoves(next).some((m) => m.productive)) return true
    if (findStockMove(next)) return true
  }
  return false
}

function finalize(state: GameState): GameState {
  if (!state.wonAt && isWon(state)) state.wonAt = Date.now()
  return state
}

/* ------------------------------------------------------------------ *
 * Difficulty
 * ------------------------------------------------------------------ */

const banked = (state: GameState): number =>
  state.foundations.reduce((n, pile) => n + pile.length, 0)

/**
 * Plays a deal out with a deliberately simple policy and reports how many
 * cards reach the foundations. This is the yardstick the dealer uses to sort
 * shuffles into difficulty bands.
 *
 * The policy only ever banks a card, uncovers a face-down one, or empties the
 * waste — all monotone — so it always terminates and never ping-pongs.
 */
export function gradeDeal(start: GameState, maxSteps = 2000): number {
  let state = start

  for (let step = 0; step < maxSteps; step++) {
    if (state.wonAt) break

    const moves = findAllMoves(state)

    // 1. Bank anything that will go.
    const toFoundation = moves.find((m) => m.to.kind === 'foundation')
    if (toFoundation) {
      const next = moveCards(state, toFoundation.from, toFoundation.fromIndex, toFoundation.to)
      if (next) {
        state = next
        continue
      }
    }

    // 2. Uncover a face-down card, deepest column first — those are worth most.
    const uncovering = moves
      .filter((m) => m.from.kind === 'tableau' && m.to.kind === 'tableau' && m.productive)
      .sort((a, b) => {
        const ai = 'index' in a.from ? a.from.index : 0
        const bi = 'index' in b.from ? b.from.index : 0
        return state.tableau[bi].length - state.tableau[ai].length
      })
      .find((m) => {
        const i = 'index' in m.from ? m.from.index : 0
        return m.fromIndex > 0 && !state.tableau[i][m.fromIndex - 1].faceUp
      })
    if (uncovering) {
      const next = moveCards(state, uncovering.from, uncovering.fromIndex, uncovering.to)
      if (next) {
        state = next
        continue
      }
    }

    // 3. Land the waste card somewhere.
    const fromWaste = moves.find((m) => m.from.kind === 'waste')
    if (fromWaste) {
      const next = moveCards(state, fromWaste.from, fromWaste.fromIndex, fromWaste.to)
      if (next) {
        state = next
        continue
      }
    }

    // 4. Otherwise turn a card, so long as something is still circulating.
    if (state.stock.length === 0 && state.waste.length === 0) break
    // A whole pass with nothing playable means the cycle is exhausted.
    if (state.stock.length === 0 && !findStockMove(state)) break
    const drawn = drawFromStock(state)
    if (!drawn) break
    state = drawn
  }

  return banked(state)
}

export interface DifficultySpec {
  key: Difficulty
  label: string
  blurb: string
  /** Final score is multiplied by this. */
  bonus: number
  /** Inclusive band of gradeDeal() results this difficulty accepts. */
  band: [number, number]
}

/*
 * Bands come from grading 4000 random shuffles. The measured distribution is
 * sharply bimodal: the greedy player either finishes a deal outright (11% of
 * shuffles) or stalls out low (median 9 cards banked, 75th percentile 15).
 * Almost nothing lands between 20 and 52, so the bands sit either side of that
 * gap rather than splitting the range evenly.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  easy: {
    key: 'easy',
    label: 'EASY',
    // The playout finished it, so a win is reachable by obvious moves alone.
    blurb: 'Guaranteed winnable',
    bonus: 1,
    band: [52, 52],
  },
  medium: {
    key: 'medium',
    label: 'MEDIUM',
    blurb: 'An ordinary shuffle',
    bonus: 1.6,
    band: [8, 20],
  },
  hard: {
    key: 'hard',
    label: 'HARD',
    blurb: 'Buried aces, few early openings',
    bonus: 2.5,
    band: [0, 4],
  },
}

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard']

/**
 * Deals until a shuffle grades into the requested band.
 *
 * Every candidate is an ordinary honest shuffle — nothing is stacked or moved
 * afterwards — so the deals stay statistically like real ones, just sampled
 * from the tail the player asked for. If the budget runs out (rare, and only
 * for the narrow bands) the closest candidate seen so far is used, so this
 * always returns a playable deal rather than hanging.
 */
export function dealFor(
  difficulty: Difficulty,
  rng: () => number = Math.random,
  attempts = 200,
): GameState {
  const [low, high] = DIFFICULTIES[difficulty].band

  let best: GameState | null = null
  let bestMiss = Infinity

  for (let i = 0; i < attempts; i++) {
    const candidate = newGame(rng)
    const grade = gradeDeal(candidate)
    if (grade >= low && grade <= high) return { ...candidate, difficulty }

    const miss = grade < low ? low - grade : grade - high
    if (miss < bestMiss) {
      bestMiss = miss
      best = candidate
    }
  }

  return { ...(best as GameState), difficulty }
}

/* ------------------------------------------------------------------ *
 * Final score
 * ------------------------------------------------------------------ */

export const elapsedSeconds = (state: GameState): number =>
  Math.max(0, Math.floor(((state.wonAt ?? Date.now()) - state.startedAt) / 1000))

/** Classic time bonus, only awarded on a win of at least 30 seconds. */
export function timeBonus(state: GameState): number {
  if (!state.wonAt) return 0
  const seconds = elapsedSeconds(state)
  if (seconds < 30) return 0
  return Math.floor(700_000 / seconds)
}

export const difficultyBonus = (state: GameState): number =>
  DIFFICULTIES[state.difficulty].bonus

/** Base points plus any time bonus, scaled by the difficulty multiplier. */
export const finalScore = (state: GameState): number =>
  Math.round((state.score + timeBonus(state)) * difficultyBonus(state))
