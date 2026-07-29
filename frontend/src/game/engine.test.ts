import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  SCORE,
  autoCompleteStep,
  buildDeck,
  canAutoComplete,
  canDrop,
  canPlaceOnFoundation,
  canPlaceOnTableau,
  dealFor,
  drawFromStock,
  findAllMoves,
  findAutoMove,
  findStockMove,
  finalScore,
  grabbableCards,
  gradeDeal,
  hasProductiveMove,
  isDeadEnd,
  isValidRun,
  isWon,
  moveCards,
  newGame,
  sendToFoundation,
  shuffle,
  timeBonus,
} from './engine.ts'
import type { Card, GameState, Rank, Suit } from './types.ts'
import { SUITS } from './types.ts'

/** Deterministic RNG so every deal in these tests is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const card = (suit: Suit, rank: number, faceUp = true): Card => ({
  id: `${suit}-${rank}`,
  suit,
  rank: rank as Rank,
  faceUp,
})

const allCards = (state: GameState): Card[] => [
  ...state.stock,
  ...state.waste,
  ...state.foundations.flat(),
  ...state.tableau.flat(),
]

/** A board with everything empty, for hand-built scenarios. */
function emptyState(): GameState {
  return {
    difficulty: 'medium',
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    score: 0,
    moves: 0,
    passes: 0,
    startedAt: 0,
    wonAt: null,
  }
}

/* ------------------------------------------------------------------ */

test('deck has 52 unique cards, 13 of each suit', () => {
  const deck = buildDeck()
  assert.equal(deck.length, 52)
  assert.equal(new Set(deck.map((c) => c.id)).size, 52)
  for (const suit of SUITS) {
    const ofSuit = deck.filter((c) => c.suit === suit)
    assert.equal(ofSuit.length, 13)
    assert.deepEqual(
      ofSuit.map((c) => c.rank).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    )
  }
})

test('shuffle preserves the multiset of cards', () => {
  const deck = buildDeck()
  const mixed = shuffle(deck, seeded(7))
  assert.equal(mixed.length, 52)
  assert.deepEqual(new Set(mixed.map((c) => c.id)), new Set(deck.map((c) => c.id)))
  // Vanishingly unlikely to be identical, so this guards against a no-op shuffle.
  assert.notDeepEqual(
    mixed.map((c) => c.id),
    deck.map((c) => c.id),
  )
})

test('deal produces the Klondike layout with 24 in stock', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const state = newGame(seeded(seed))
    assert.equal(allCards(state).length, 52, 'all 52 cards accounted for')
    assert.equal(new Set(allCards(state).map((c) => c.id)).size, 52, 'no duplicates')
    assert.equal(state.stock.length, 24)
    assert.equal(state.waste.length, 0)

    state.tableau.forEach((pile, i) => {
      assert.equal(pile.length, i + 1, `column ${i} holds ${i + 1} cards`)
      assert.ok(pile[pile.length - 1].faceUp, `column ${i} top card is face up`)
      for (let j = 0; j < pile.length - 1; j++) {
        assert.ok(!pile[j].faceUp, `column ${i} card ${j} is face down`)
      }
    })
    assert.ok(state.stock.every((c) => !c.faceUp), 'stock is face down')
  }
})

/* ---- placement rules ---------------------------------------------- */

test('foundations take an ace first, then ascend in suit', () => {
  const state = emptyState()
  assert.ok(canPlaceOnFoundation(card('spades', 1), 0, state))
  assert.ok(!canPlaceOnFoundation(card('spades', 2), 0, state), 'empty foundation rejects a two')
  assert.ok(!canPlaceOnFoundation(card('hearts', 1), 0, state), 'wrong suit slot rejected')

  state.foundations[0] = [card('spades', 1)]
  assert.ok(canPlaceOnFoundation(card('spades', 2), 0, state))
  assert.ok(!canPlaceOnFoundation(card('spades', 3), 0, state), 'no rank skipping')
  assert.ok(!canPlaceOnFoundation(card('clubs', 2), 0, state), 'no mixing suits')
})

test('tableau builds down in alternating colours; empty columns take only a king', () => {
  const state = emptyState()
  assert.ok(canPlaceOnTableau(card('spades', 13), 0, state), 'king onto empty column')
  assert.ok(!canPlaceOnTableau(card('spades', 12), 0, state), 'queen rejected by empty column')

  state.tableau[1] = [card('spades', 8)] // black 8
  assert.ok(canPlaceOnTableau(card('hearts', 7), 1, state), 'red 7 onto black 8')
  assert.ok(canPlaceOnTableau(card('diamonds', 7), 1, state), 'red 7 onto black 8')
  assert.ok(!canPlaceOnTableau(card('clubs', 7), 1, state), 'black on black rejected')
  assert.ok(!canPlaceOnTableau(card('hearts', 6), 1, state), 'wrong rank rejected')
  assert.ok(!canPlaceOnTableau(card('hearts', 9), 1, state), 'ascending rejected')

  state.tableau[2] = [card('spades', 8, false)]
  assert.ok(!canPlaceOnTableau(card('hearts', 7), 2, state), 'cannot build on a face-down card')
})

test('a run is only draggable when it descends in alternating colours', () => {
  assert.ok(isValidRun([card('spades', 8), card('hearts', 7), card('clubs', 6)]))
  assert.ok(!isValidRun([card('spades', 8), card('clubs', 7)]), 'same colour')
  assert.ok(!isValidRun([card('spades', 8), card('hearts', 6)]), 'rank gap')
  assert.ok(!isValidRun([card('spades', 8, false), card('hearts', 7)]), 'face-down card')
  assert.ok(!isValidRun([]), 'empty run')
})

test('only the exposed card leaves the waste or a foundation', () => {
  const state = emptyState()
  state.waste = [card('spades', 3), card('hearts', 4)]
  assert.equal(grabbableCards(state, { kind: 'waste' }, 1)?.length, 1)
  assert.equal(grabbableCards(state, { kind: 'waste' }, 0), null, 'buried waste card')
  assert.equal(grabbableCards(state, { kind: 'stock' }, 0), null, 'stock is never grabbable')

  state.tableau[0] = [card('spades', 8, false), card('hearts', 7), card('clubs', 6)]
  assert.equal(grabbableCards(state, { kind: 'tableau', index: 0 }, 1)?.length, 2, 'valid run of two')
  assert.equal(grabbableCards(state, { kind: 'tableau', index: 0 }, 0), null, 'face-down card')
})

test('foundations accept a single card, never a run', () => {
  const state = emptyState()
  const run = [card('spades', 1), card('hearts', 13)]
  assert.ok(!canDrop(state, run, { kind: 'foundation', index: 0 }))
  assert.ok(canDrop(state, [card('spades', 1)], { kind: 'foundation', index: 0 }))
  assert.ok(!canDrop(state, [card('spades', 1)], { kind: 'stock' }), 'stock is not a target')
  assert.ok(!canDrop(state, [card('spades', 1)], { kind: 'waste' }), 'waste is not a target')
})

/* ---- moves and scoring -------------------------------------------- */

test('moving off a column flips the card beneath and scores both actions', () => {
  const state = emptyState()
  state.tableau[0] = [card('clubs', 9, false), card('hearts', 7)]
  state.tableau[1] = [card('spades', 8)]

  const next = moveCards(state, { kind: 'tableau', index: 0 }, 1, { kind: 'tableau', index: 1 })
  assert.ok(next)
  assert.equal(next.tableau[1].length, 2)
  assert.ok(next.tableau[0][0].faceUp, 'uncovered card turned face up')
  assert.equal(next.score, SCORE.turnOverTableauCard, 'tableau-to-tableau only pays the flip')
  assert.equal(next.moves, 1)
  assert.equal(state.tableau[0].length, 2, 'original state untouched')
})

test('scoring table for waste and foundation moves', () => {
  let state = emptyState()
  state.waste = [card('spades', 1)]
  state = moveCards(state, { kind: 'waste' }, 0, { kind: 'foundation', index: 0 })!
  assert.equal(state.score, SCORE.wasteToFoundation)

  state.waste = [card('hearts', 12)]
  state.tableau[0] = [card('spades', 13)]
  state = moveCards(state, { kind: 'waste' }, 0, { kind: 'tableau', index: 0 })!
  assert.equal(state.score, SCORE.wasteToFoundation + SCORE.wasteToTableau)

  // Pulling back off a foundation costs points.
  const before = state.score
  state.tableau[1] = [card('hearts', 2)]
  state.foundations[0] = [card('spades', 1)]
  state = moveCards(state, { kind: 'foundation', index: 0 }, 0, { kind: 'tableau', index: 1 })!
  assert.equal(state.score, before + SCORE.foundationToTableau)
})

test('score never falls below zero', () => {
  const state = emptyState()
  state.foundations[0] = [card('spades', 1)]
  state.tableau[0] = [card('hearts', 2)]
  const next = moveCards(state, { kind: 'foundation', index: 0 }, 0, { kind: 'tableau', index: 0 })!
  assert.equal(next.score, 0, `${SCORE.foundationToTableau} from 0 is clamped`)
})

test('illegal moves return null and change nothing', () => {
  const state = emptyState()
  state.tableau[0] = [card('spades', 8)]
  state.tableau[1] = [card('clubs', 7)]
  assert.equal(
    moveCards(state, { kind: 'tableau', index: 1 }, 0, { kind: 'tableau', index: 0 }),
    null,
    'black on black',
  )
  assert.equal(
    moveCards(state, { kind: 'tableau', index: 0 }, 0, { kind: 'tableau', index: 0 }),
    null,
    'onto itself',
  )
})

/* ---- stock ---------------------------------------------------------- */

test('draw turns one card at a time, face up', () => {
  const state = newGame(seeded(3))
  const next = drawFromStock(state)!
  assert.equal(next.stock.length, 23)
  assert.equal(next.waste.length, 1)
  assert.ok(next.waste[0].faceUp)
  assert.equal(next.moves, 1)
})

test('recycling costs 100, restores order, and counts a pass', () => {
  let state = newGame(seeded(11))
  state.score = 500
  for (let i = 0; i < 24; i++) state = drawFromStock(state)!
  assert.equal(state.stock.length, 0)
  assert.equal(state.waste.length, 24)

  const wasteOrder = state.waste.map((c) => c.id)
  const recycled = drawFromStock(state)!
  assert.equal(recycled.stock.length, 24)
  assert.equal(recycled.waste.length, 0)
  assert.equal(recycled.passes, 1)
  assert.equal(recycled.score, 500 + SCORE.recycleWaste)
  assert.ok(recycled.stock.every((c) => !c.faceUp), 'recycled stock is face down')
  // Drawing again must reproduce the same order as the first pass.
  assert.deepEqual(recycled.stock.map((c) => c.id).reverse(), wasteOrder)
})

test('an empty stock with an empty waste is not a move', () => {
  assert.equal(drawFromStock(emptyState()), null)
})

/* ---- shortcuts ------------------------------------------------------ */

test('sendToFoundation only takes the exposed card', () => {
  const state = emptyState()
  state.tableau[0] = [card('hearts', 5), card('spades', 1)]
  assert.equal(sendToFoundation(state, { kind: 'tableau', index: 0 }, 0), null, 'buried card')
  const next = sendToFoundation(state, { kind: 'tableau', index: 0 }, 1)
  assert.ok(next)
  assert.deepEqual(next.foundations[0].map((c) => c.id), ['spades-1'])
})

test('auto-move prefers a foundation, then a non-empty column', () => {
  const state = emptyState()
  state.waste = [card('spades', 1)]
  assert.deepEqual(findAutoMove(state, { kind: 'waste' }, 0), { kind: 'foundation', index: 0 })

  const t = emptyState()
  t.waste = [card('hearts', 7)]
  t.tableau[0] = [] // empty column
  t.tableau[3] = [card('spades', 8)] // legal landing spot
  assert.deepEqual(findAutoMove(t, { kind: 'waste' }, 0), { kind: 'tableau', index: 3 })
})

/* ---- winning -------------------------------------------------------- */

test('auto-complete finishes a solved board and flags the win', () => {
  const state = emptyState()
  // One suit per column, king at the bottom, so each ace is exposed on top.
  SUITS.forEach((suit, col) => {
    for (let rank = 13; rank >= 1; rank--) state.tableau[col].push(card(suit, rank))
  })
  assert.ok(canAutoComplete(state))

  let current = state
  let steps = 0
  for (;;) {
    const next = autoCompleteStep(current)
    if (!next) break
    current = next
    if (++steps > 100) assert.fail('auto-complete did not terminate')
  }
  assert.equal(steps, 52, 'every card went home')
  assert.ok(isWon(current))
  assert.ok(current.wonAt !== null, 'win timestamp recorded')
  assert.ok(current.tableau.every((p) => p.length === 0))
})

test('auto-complete is unavailable while cards are hidden or undealt', () => {
  const withStock = emptyState()
  withStock.stock = [card('spades', 5, false)]
  assert.ok(!canAutoComplete(withStock))

  const withFaceDown = emptyState()
  withFaceDown.tableau[0] = [card('spades', 5, false)]
  assert.ok(!canAutoComplete(withFaceDown))
})

test('time bonus rewards fast wins and is skipped under 30 seconds', () => {
  // Pinned to easy so the x1 multiplier keeps this about the time bonus alone;
  // the multiplier itself is covered by the difficulty tests below.
  const base = { ...emptyState(), difficulty: 'easy' as const, score: 100 }

  const quick = { ...base, startedAt: 0, wonAt: 20_000 }
  assert.equal(timeBonus(quick), 0, 'sub-30s wins get no bonus')
  assert.equal(finalScore(quick), 100)

  const paced = { ...base, startedAt: 0, wonAt: 200_000 }
  assert.equal(timeBonus(paced), Math.floor(700_000 / 200))
  assert.equal(finalScore(paced), 100 + Math.floor(700_000 / 200))

  assert.equal(timeBonus(base), 0, 'no bonus without a win')
})

/* ---- dead ends -------------------------------------------------------- */

test('a fresh deal is never a dead end', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const state = newGame(seeded(seed))
    assert.ok(!isDeadEnd(state), `seed ${seed} was dead on the deal`)
    assert.ok(hasProductiveMove(state), `seed ${seed} had no productive opening`)
  }
})

test('a blocked board with nothing left to draw is a dead end', () => {
  const state = emptyState()
  // Every column tops out with a black card that no other column can accept,
  // and the foundations are empty so nothing can be banked.
  state.tableau[0] = [card('spades', 5)]
  state.tableau[1] = [card('clubs', 7)]
  state.tableau[2] = [card('spades', 9)]
  state.tableau[3] = [card('clubs', 11)]
  state.tableau[4] = [card('spades', 3)]
  state.tableau[5] = [card('clubs', 13)]
  state.tableau[6] = [card('spades', 13)]

  assert.deepEqual(findAllMoves(state), [], 'no move should be available')
  assert.equal(findStockMove(state), null)
  assert.ok(isDeadEnd(state))
  assert.ok(!hasProductiveMove(state))
})

test('a playable stock card keeps the game alive even when the board is stuck', () => {
  const state = emptyState()
  state.tableau[0] = [card('spades', 5)]
  state.tableau[1] = [card('clubs', 7)]
  state.tableau[2] = [card('spades', 9)]
  state.tableau[3] = [card('clubs', 11)]
  state.tableau[4] = [card('spades', 3)]
  state.tableau[5] = [card('clubs', 13)]
  state.tableau[6] = [card('spades', 13)]
  assert.ok(isDeadEnd(state), 'precondition: stuck without a stock')

  // The red four is buried at the bottom of the stock, but draw-one with
  // unlimited redeals always brings it round eventually.
  state.stock = [card('hearts', 4, false), card('clubs', 6, false), card('clubs', 8, false)]
  assert.ok(!isDeadEnd(state), 'buried playable card must count')
  assert.ok(hasProductiveMove(state))
  assert.equal(findStockMove(state)?.card.id, 'hearts-4')
})

test('an unplayable stock does not save a stuck board', () => {
  const state = emptyState()
  state.tableau[0] = [card('spades', 5)]
  state.tableau[1] = [card('clubs', 7)]
  state.tableau[2] = [card('spades', 9)]
  state.tableau[3] = [card('clubs', 11)]
  state.tableau[4] = [card('spades', 3)]
  state.tableau[5] = [card('clubs', 13)]
  state.tableau[6] = [card('spades', 13)]
  // Black cards that fit on none of those black tops, and no aces.
  state.stock = [card('clubs', 5, false), card('spades', 7, false)]
  state.waste = [card('clubs', 9)]

  assert.ok(isDeadEnd(state), 'cycling these forever changes nothing')
})

test('a won board is never reported as a dead end', () => {
  const state = emptyState()
  SUITS.forEach((suit, i) => {
    for (let rank = 1; rank <= 13; rank++) state.foundations[i].push(card(suit, rank))
  })
  state.wonAt = 1
  assert.ok(!isDeadEnd(state))
  assert.ok(!hasProductiveMove(state), 'nothing left to do, but that is a win not a loss')
})

test('legal-but-pointless shuffles are not counted as progress', () => {
  const state = emptyState()
  // The black jack can hop between the two red queens forever. No black king
  // is exposed, so neither queen can move and no column can be freed.
  state.tableau[0] = [card('hearts', 12), card('spades', 11)]
  state.tableau[1] = [card('diamonds', 12)]

  const moves = findAllMoves(state)
  assert.ok(moves.length > 0, 'the hop is still legal')
  assert.ok(!isDeadEnd(state), 'a legal move exists, so this is not a hard dead end')
  assert.ok(!hasProductiveMove(state), 'but nothing on the board actually advances')
})

test('relocating a whole column onto an empty one is not progress', () => {
  const state = emptyState()
  state.tableau[0] = [card('spades', 13), card('hearts', 12)]
  state.tableau[1] = [] // empty column

  const relocation = findAllMoves(state).find(
    (m) => m.from.kind === 'tableau' && m.fromIndex === 0 && m.to.kind === 'tableau',
  )
  assert.ok(relocation, 'the king run can legally move to the empty column')
  assert.equal(relocation.productive, false)
  assert.ok(!hasProductiveMove(state))
})

test('uncovering a face-down card counts as progress', () => {
  const state = emptyState()
  state.tableau[0] = [card('diamonds', 7, false), card('spades', 11)]
  state.tableau[1] = [card('hearts', 12)]

  const move = findAllMoves(state).find((m) => m.to.kind === 'tableau' && m.from.kind === 'tableau')
  assert.ok(move)
  assert.equal(move.productive, true)
  assert.ok(hasProductiveMove(state))
})

test('pulling a card off a foundation counts when it unblocks the board', () => {
  const state = emptyState()
  // Nothing moves on its own: the black five has no red six to sit on...
  state.tableau[0] = [card('clubs', 9, false), card('spades', 5)]
  state.tableau[1] = [card('clubs', 7)]
  // ...but the red six can come back off the foundation onto the black seven,
  // and then the five follows, uncovering the face-down club.
  state.foundations[2] = [card('diamonds', 1), card('diamonds', 2), card('diamonds', 3),
    card('diamonds', 4), card('diamonds', 5), card('diamonds', 6)]

  assert.ok(!findAllMoves(state).some((m) => m.productive), 'no direct progress')
  assert.ok(hasProductiveMove(state), 'the foundation pull unblocks a face-down card')
})

test('dead-end detection agrees with exhaustive play', () => {
  // Play greedily to exhaustion; the moment the engine says "dead end", verify
  // by brute force that no legal move of any kind actually remains.
  for (let seed = 200; seed < 240; seed++) {
    let state = newGame(seeded(seed))

    for (let step = 0; step < 600; step++) {
      if (isDeadEnd(state)) {
        // Brute force: try every source position against every destination.
        const targets: Parameters<typeof moveCards>[3][] = [
          ...state.tableau.map((_, i) => ({ kind: 'tableau' as const, index: i })),
          ...state.foundations.map((_, i) => ({ kind: 'foundation' as const, index: i })),
        ]
        const sources: Array<{ pile: Parameters<typeof moveCards>[1]; index: number }> = []
        state.tableau.forEach((pile, i) =>
          pile.forEach((_, j) => sources.push({ pile: { kind: 'tableau', index: i }, index: j })),
        )
        state.waste.forEach((_, j) => sources.push({ pile: { kind: 'waste' }, index: j }))
        state.foundations.forEach((pile, i) =>
          pile.forEach((_, j) => sources.push({ pile: { kind: 'foundation', index: i }, index: j })),
        )

        for (const source of sources) {
          for (const to of targets) {
            assert.equal(
              moveCards(state, source.pile, source.index, to),
              null,
              `seed ${seed}: reported a dead end but a move existed`,
            )
          }
        }
        // And confirm no card left in the cycle could ever be played.
        assert.equal(findStockMove(state), null, `seed ${seed}: a stock card was still playable`)
        break
      }

      const move = findAllMoves(state).find((m) => m.productive)
      const next = move
        ? moveCards(state, move.from, move.fromIndex, move.to)
        : drawFromStock(state)
      if (!next) break
      state = next
      if (state.wonAt) break
    }
  }
})

/* ---- difficulty -------------------------------------------------------- */

test('every difficulty deals a legal, complete Klondike layout', () => {
  const rng = seeded(31337)
  for (const key of DIFFICULTY_ORDER) {
    for (let i = 0; i < 20; i++) {
      const state = dealFor(key, rng)
      assert.equal(state.difficulty, key)
      assert.equal(allCards(state).length, 52, `${key}: card count`)
      assert.equal(new Set(allCards(state).map((c) => c.id)).size, 52, `${key}: duplicates`)
      assert.equal(state.stock.length, 24, `${key}: stock size`)
      state.tableau.forEach((pile, col) => {
        assert.equal(pile.length, col + 1, `${key}: column ${col}`)
        assert.ok(pile[pile.length - 1].faceUp, `${key}: column ${col} top is face up`)
      })
      assert.ok(!isDeadEnd(state), `${key}: dealt a dead board`)
    }
  }
})

test('dealt shuffles land inside their difficulty band', () => {
  const rng = seeded(8675309)
  for (const key of DIFFICULTY_ORDER) {
    const [low, high] = DIFFICULTIES[key].band
    for (let i = 0; i < 25; i++) {
      const grade = gradeDeal(dealFor(key, rng))
      assert.ok(
        grade >= low && grade <= high,
        `${key}: graded ${grade}, expected ${low}-${high}`,
      )
    }
  }
})

test('easy deals are winnable by construction', () => {
  // The band requires the greedy playout to bank all 52, which is a played-out
  // proof that a win exists — not an estimate.
  const rng = seeded(5150)
  for (let i = 0; i < 20; i++) {
    assert.equal(gradeDeal(dealFor('easy', rng)), 52)
  }
})

test('the bands separate: easy is strictly richer than medium than hard', () => {
  const rng = seeded(24601)
  const mean = (key: (typeof DIFFICULTY_ORDER)[number]) => {
    const samples = Array.from({ length: 30 }, () => gradeDeal(dealFor(key, rng)))
    return samples.reduce((a, b) => a + b, 0) / samples.length
  }
  const easy = mean('easy')
  const medium = mean('medium')
  const hard = mean('hard')
  assert.ok(easy > medium, `easy ${easy} should beat medium ${medium}`)
  assert.ok(medium > hard, `medium ${medium} should beat hard ${hard}`)
})

test('difficulty bands do not overlap and cover the multiplier ordering', () => {
  const bands = DIFFICULTY_ORDER.map((k) => DIFFICULTIES[k].band)
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const [aLow, aHigh] = bands[i]
      const [bLow, bHigh] = bands[j]
      assert.ok(aHigh < bLow || bHigh < aLow, `bands ${i} and ${j} overlap`)
    }
  }
  // Harder deals must always pay at least as well.
  assert.ok(DIFFICULTIES.hard.bonus > DIFFICULTIES.medium.bonus)
  assert.ok(DIFFICULTIES.medium.bonus > DIFFICULTIES.easy.bonus)
})

test('the difficulty multiplier scales base points and the time bonus together', () => {
  const base = { ...emptyState(), score: 1000, startedAt: 0, wonAt: 200_000 }
  const bonus = Math.floor(700_000 / 200)

  const easy = { ...base, difficulty: 'easy' as const }
  const hard = { ...base, difficulty: 'hard' as const }

  assert.equal(finalScore(easy), 1000 + bonus, 'easy is the unscaled baseline')
  assert.equal(finalScore(hard), Math.round((1000 + bonus) * DIFFICULTIES.hard.bonus))
  assert.ok(finalScore(hard) > finalScore(easy))
})

test('an unfinished run gets no time bonus regardless of difficulty', () => {
  const unfinished = { ...emptyState(), score: 400, difficulty: 'hard' as const }
  assert.equal(timeBonus(unfinished), 0)
  assert.equal(finalScore(unfinished), Math.round(400 * DIFFICULTIES.hard.bonus))
})

/* ---- invariants over long random play -------------------------------- */

test('random play never loses, duplicates or reveals a card illegally', () => {
  for (let seed = 100; seed < 130; seed++) {
    const rng = seeded(seed)
    let state = newGame(rng)

    for (let step = 0; step < 400; step++) {
      const sources: Array<{ pile: Parameters<typeof findAutoMove>[1]; index: number }> = []
      if (state.waste.length) sources.push({ pile: { kind: 'waste' }, index: state.waste.length - 1 })
      state.tableau.forEach((pile, i) =>
        pile.forEach((c, j) => {
          if (c.faceUp) sources.push({ pile: { kind: 'tableau', index: i }, index: j })
        }),
      )

      let moved = false
      for (const source of sources) {
        const target = findAutoMove(state, source.pile, source.index)
        if (!target) continue
        const next = moveCards(state, source.pile, source.index, target)
        if (next) {
          state = next
          moved = true
          break
        }
      }
      if (!moved) {
        const drawn = drawFromStock(state)
        if (!drawn) break
        state = drawn
      }

      const cards = allCards(state)
      assert.equal(cards.length, 52, `seed ${seed} step ${step}: card count`)
      assert.equal(new Set(cards.map((c) => c.id)).size, 52, `seed ${seed} step ${step}: duplicates`)
      assert.ok(state.score >= 0, `seed ${seed} step ${step}: negative score`)

      for (const pile of state.tableau) {
        // A face-down card may never sit on top of a face-up one.
        let seenFaceUp = false
        for (const c of pile) {
          if (c.faceUp) seenFaceUp = true
          else assert.ok(!seenFaceUp, `seed ${seed}: face-down card above a face-up one`)
        }
      }
      for (const pile of state.foundations) {
        pile.forEach((c, i) => assert.equal(c.rank, i + 1, `seed ${seed}: foundation out of order`))
        assert.equal(new Set(pile.map((c) => c.suit)).size <= 1, true, `seed ${seed}: mixed foundation`)
      }
    }
  }
})
