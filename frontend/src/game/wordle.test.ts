import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DIFFICULTY_BONUS } from './difficulty.ts'
import { ANSWERS, GUESSES, WORD_LENGTH } from './words.ts'
import {
  MAX_GUESSES,
  WORDLE_SCORE,
  elapsedSeconds,
  finalScore,
  hardModeViolation,
  isOver,
  isValidGuess,
  newWordle,
  scoreGuess,
  submitGuess,
  timeBonus,
} from './wordle.ts'
import type { LetterMark, WordleState } from './wordle.ts'

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const GUESS_LIST = [...GUESSES]

const countOf = (word: string, letter: string): number =>
  [...word].filter((c) => c === letter).length

/** Words that are certainly not the answer, for filling rows. */
function fillers(state: WordleState, count: number): string[] {
  const words = ANSWERS.filter((w) => w !== state.answer).slice(0, count)
  assert.equal(words.length, count)
  return words
}

function play(state: WordleState, words: string[]): WordleState {
  let current = state
  for (const word of words) {
    const next = submitGuess(current, word)
    assert.ok(next, `"${word}" should be accepted`)
    current = next
  }
  return current
}

const greenCount = (state: WordleState): number => {
  const green = new Set<number>()
  for (const guess of state.guesses) {
    guess.marks.forEach((mark, i) => {
      if (mark === 'correct') green.add(i)
    })
  }
  return green.size
}

/* ---- scoreGuess -------------------------------------------------- */

test('scoreGuess handles the classic duplicate-letter cases', () => {
  const cases: { answer: string; guess: string; marks: LetterMark[] }[] = [
    { answer: 'crane', guess: 'crane', marks: ['correct', 'correct', 'correct', 'correct', 'correct'] },
    // One b is consumed by the exact match at index 2, leaving one for index 0.
    // Index 3 is e against e, an exact match, so it is green rather than yellow.
    { answer: 'abbey', guess: 'babes', marks: ['present', 'present', 'correct', 'correct', 'absent'] },
    // The answer's single e is consumed at index 4, so the earlier e's are
    // absent — but the answer's unmatched r at index 1 still backs a yellow.
    { answer: 'crane', guess: 'eerie', marks: ['absent', 'absent', 'present', 'absent', 'correct'] },
    { answer: 'sassy', guess: 'essay', marks: ['absent', 'present', 'correct', 'present', 'correct'] },
    { answer: 'abide', guess: 'eerie', marks: ['absent', 'absent', 'absent', 'present', 'correct'] },
    // Two of the answer's three e's are matched exactly (indices 1 and 4); the
    // third, at index 2, backs the yellow at index 0.
    { answer: 'geese', guess: 'eexxe', marks: ['present', 'correct', 'absent', 'absent', 'correct'] },
  ]

  for (const { answer, guess, marks } of cases) {
    assert.deepEqual(scoreGuess(guess, answer), marks, `${answer} / ${guess}`)
  }
})

test('a yellow is never reported that the answer cannot back', () => {
  const rng = seeded(99)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]

  for (let n = 0; n < 400; n++) {
    const answer = pick(ANSWERS)
    const guess = pick(GUESS_LIST)
    const marks = scoreGuess(guess, answer)

    for (const letter of new Set(guess)) {
      const inAnswer = countOf(answer, letter)
      const claimed = marks.filter((mark, i) => mark !== 'absent' && guess[i] === letter).length
      assert.ok(claimed <= inAnswer, `${answer} / ${guess}: ${letter} claimed ${claimed} of ${inAnswer}`)
      // The two-pass result is exact, not merely conservative.
      assert.equal(claimed, Math.min(inAnswer, countOf(guess, letter)), `${answer} / ${guess}: ${letter}`)
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
      assert.equal(marks[i] === 'correct', guess[i] === answer[i], `${answer} / ${guess} at ${i}`)
    }
  }
})

test('scoreGuess returns a fresh five-mark array and leaves its inputs alone', () => {
  const answer = 'crane'
  const guess = 'stare'

  const first = scoreGuess(guess, answer)
  assert.equal(first.length, WORD_LENGTH)
  first[0] = 'correct'

  const second = scoreGuess(guess, answer)
  assert.notEqual(first, second, 'each call must return its own array')
  assert.equal(second[0], 'absent', 'a mutated result must not leak into the next call')
  assert.equal(answer, 'crane')
  assert.equal(guess, 'stare')
})

test('scoreGuess is case-insensitive', () => {
  assert.deepEqual(scoreGuess('STARE', 'CRANE'), scoreGuess('stare', 'crane'))
})

/* ---- new game ---------------------------------------------------- */

test('a seeded game is reproducible and different seeds differ', () => {
  assert.equal(newWordle('medium', seeded(7)).answer, newWordle('medium', seeded(7)).answer)

  const answers = new Set([1, 2, 3, 4, 5].map((s) => newWordle('easy', seeded(s)).answer))
  assert.ok(answers.size > 1, 'different seeds should not all pick the same word')
})

test('the answer is always a curated word the game would accept', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const state = newWordle('hard', seeded(seed))
    assert.ok(ANSWERS.includes(state.answer), `${state.answer} should be in ANSWERS`)
    assert.ok(isValidGuess(state.answer), `${state.answer} should be a valid guess`)
  }
})

test('a new game starts empty, with the difficulty rules applied', () => {
  const easy = newWordle('easy', seeded(11))
  const medium = newWordle('medium', seeded(12))
  const hard = newWordle('hard', seeded(13))

  assert.equal(easy.maxGuesses, 7)
  assert.equal(medium.maxGuesses, 6)
  assert.equal(hard.maxGuesses, 6)
  assert.deepEqual([easy.hardMode, medium.hardMode, hard.hardMode], [false, false, true])
  assert.deepEqual(MAX_GUESSES, { easy: 7, medium: 6, hard: 6 })

  for (const state of [easy, medium, hard]) {
    assert.deepEqual(state.guesses, [])
    assert.deepEqual(state.keyboard, {})
    assert.equal(state.score, 0)
    assert.equal(state.wonAt, null)
    assert.equal(state.lostAt, null)
    assert.equal(isOver(state), false)
  }
})

/* ---- guess validation -------------------------------------------- */

test('isValidGuess accepts any casing of a known five-letter word', () => {
  assert.ok(isValidGuess('crane'))
  assert.ok(isValidGuess('CRANE'))
  assert.ok(isValidGuess('CrAnE'))
})

test('isValidGuess rejects the wrong shape or an unknown word', () => {
  assert.equal(isValidGuess('cran'), false, 'too short')
  assert.equal(isValidGuess('cranes'), false, 'too long')
  assert.equal(isValidGuess(''), false, 'empty')
  assert.equal(isValidGuess('cr1ne'), false, 'digit')
  assert.equal(isValidGuess('cr ne'), false, 'space')
  assert.equal(isValidGuess('crané'), false, 'accent')
  assert.equal(isValidGuess('zzzzz'), false, 'not a word')
  assert.equal(GUESSES.has('zzzzz'), false, 'fixture check')
})

/* ---- playing ----------------------------------------------------- */

test('guessing the answer first wins and pays the full guess bonus', () => {
  const state = newWordle('medium', seeded(21))
  const won = submitGuess(state, state.answer.toUpperCase())
  assert.ok(won)

  assert.ok(won.wonAt)
  assert.equal(won.lostAt, null)
  assert.ok(isOver(won))
  assert.equal(won.guesses.length, 1)
  assert.equal(won.guesses[0].word, state.answer, 'the guess is stored lower case')
  assert.equal(won.score, WORD_LENGTH * WORDLE_SCORE.perGreen + WORDLE_SCORE.completion + 900)
})

test('winning on the last row still wins, at the smallest guess bonus', () => {
  const state = newWordle('medium', seeded(22))
  const before = play(state, fillers(state, 5))
  assert.equal(isOver(before), false, 'five of six rows used')

  const won = submitGuess(before, state.answer)
  assert.ok(won)
  assert.equal(won.guesses.length, 6)
  assert.ok(won.wonAt)
  assert.equal(won.lostAt, null, 'a win on the last row is not a loss')

  const guessBonus = 900 - 5 * 130
  assert.equal(guessBonus, 250)
  const newGreens = WORD_LENGTH - greenCount(before)
  assert.equal(
    won.score - before.score,
    WORDLE_SCORE.completion + guessBonus + newGreens * WORDLE_SCORE.perGreen,
  )
})

test('running out of rows loses', () => {
  const state = newWordle('medium', seeded(23))
  const lost = play(state, fillers(state, 6))

  assert.equal(lost.guesses.length, 6)
  assert.equal(lost.wonAt, null)
  assert.ok(lost.lostAt)
  assert.ok(isOver(lost))
})

test('easy gets a seventh row', () => {
  const state = newWordle('easy', seeded(24))
  const six = play(state, fillers(state, 6))
  assert.equal(isOver(six), false, 'easy still has a row left')

  const won = submitGuess(six, state.answer)
  assert.ok(won)
  assert.ok(won.wonAt)
})

test('a guess after the game is over is refused', () => {
  const state = newWordle('medium', seeded(25))
  const won = submitGuess(state, state.answer)!
  assert.equal(submitGuess(won, fillers(state, 1)[0]), null)

  const lost = play(newWordle('medium', seeded(26)), fillers(newWordle('medium', seeded(26)), 6))
  assert.equal(submitGuess(lost, lost.answer), null)
})

test('an unknown word is refused and costs no row', () => {
  const state = play(newWordle('medium', seeded(27)), fillers(newWordle('medium', seeded(27)), 1))
  for (const bad of ['zzzzz', 'cran', 'cr1ne', '']) {
    assert.equal(submitGuess(state, bad), null, bad)
  }
  assert.equal(state.guesses.length, 1, 'refused guesses never consume a row')
})

test('submitting never mutates the state it was given', () => {
  const state = newWordle('medium', seeded(28))
  const snapshot = { guesses: state.guesses, keyboard: { ...state.keyboard }, score: state.score }

  const next = submitGuess(state, state.answer)!
  assert.notEqual(next, state)
  assert.notEqual(next.guesses, state.guesses)
  assert.equal(state.guesses.length, 0)
  assert.equal(state.guesses, snapshot.guesses)
  assert.deepEqual(state.keyboard, snapshot.keyboard)
  assert.equal(state.score, snapshot.score)
  assert.equal(state.wonAt, null)
})

/* ---- hard mode --------------------------------------------------- */

/** A hard game on a known answer, one row in: _RA_E with a C somewhere. */
function hardGame(): WordleState {
  const base = { ...newWordle('hard', seeded(31)), answer: 'crane' }
  const opened = submitGuess(base, 'brace')
  assert.ok(opened)
  assert.deepEqual(opened.guesses[0].marks, ['absent', 'correct', 'correct', 'present', 'correct'])
  return opened
}

test('hard mode holds every green in place', () => {
  const state = hardGame()
  assert.equal(hardModeViolation(state, 'brine'), '3rd letter must be A')
  assert.equal(hardModeViolation(state, 'slate'), '2nd letter must be R')
  assert.equal(submitGuess(state, 'brine'), null)
  assert.equal(state.guesses.length, 1, 'a rejected guess costs no row')
})

test('hard mode insists on reusing a yellow letter', () => {
  const state = hardGame()
  assert.equal(hardModeViolation(state, 'grape'), 'Guess must use C')
  assert.equal(submitGuess(state, 'grape'), null)
})

test('hard mode accepts a guess that keeps everything revealed', () => {
  const state = hardGame()
  assert.equal(hardModeViolation(state, 'trace'), null)
  assert.equal(hardModeViolation(state, 'TRACE'), null)

  const next = submitGuess(state, 'trace')
  assert.ok(next)
  assert.equal(next.guesses.length, 2)
})

test('with hard mode off nothing is required', () => {
  const relaxed = { ...hardGame(), hardMode: false }
  for (const word of ['brine', 'slate', 'grape']) {
    assert.equal(hardModeViolation(relaxed, word), null, word)
    assert.ok(submitGuess(relaxed, word), word)
  }
})

/* ---- keyboard ---------------------------------------------------- */

test('a keyboard mark only ever improves', () => {
  const base = { ...newWordle('medium', seeded(41)), answer: 'crane' }

  const one = submitGuess(base, 'stare')!
  assert.equal(one.keyboard.r, 'present')
  assert.equal(one.keyboard.a, 'correct')
  assert.equal(one.keyboard.s, 'absent')

  const two = submitGuess(one, 'crane')!
  assert.equal(two.keyboard.r, 'correct', 'present must not block a later correct')
  assert.equal(two.keyboard.s, 'absent')
})

test('a correct letter is never downgraded by a later absent', () => {
  const base = { ...newWordle('medium', seeded(42)), answer: 'crane' }

  const one = submitGuess(base, 'crimp')!
  assert.equal(one.keyboard.c, 'correct')

  // cocoa marks the second c absent — the answer has only the one, already matched.
  const two = submitGuess(one, 'cocoa')!
  assert.deepEqual(two.guesses[1].marks, ['correct', 'absent', 'absent', 'absent', 'present'])
  assert.equal(two.keyboard.c, 'correct')
})

/* ---- scoring ----------------------------------------------------- */

test('a guess pays for the greens and yellows it reveals', () => {
  const base = { ...newWordle('medium', seeded(51)), answer: 'crane' }
  const one = submitGuess(base, 'stare')!
  // a and e green, r yellow.
  assert.equal(one.score, 2 * WORDLE_SCORE.perGreen + WORDLE_SCORE.perYellow)
})

test('re-confirming what is already known pays nothing', () => {
  const base = { ...newWordle('medium', seeded(52)), answer: 'crane' }
  const one = submitGuess(base, 'stare')!

  const twice = submitGuess(one, 'stare')!
  assert.equal(twice.score, one.score, 'the same guess again cannot farm points')

  // A different word confirming the same positions and letter is worth nothing too.
  const other = submitGuess(twice, 'share')!
  assert.equal(other.score, one.score)
  assert.equal(other.guesses.length, 3, 'the rows were still spent')
})

test('the win bonus shrinks with each row used', () => {
  const first = submitGuess(newWordle('medium', seeded(53)), newWordle('medium', seeded(53)).answer)!

  const state = newWordle('medium', seeded(54))
  const before = play(state, fillers(state, 2))
  const third = submitGuess(before, state.answer)!

  const wonOnThird = third.score - before.score - (WORD_LENGTH - greenCount(before)) * WORDLE_SCORE.perGreen
  assert.equal(wonOnThird, WORDLE_SCORE.completion + 900 - 2 * 130)
  assert.ok(first.score > wonOnThird, 'winning sooner is worth more')
})

test('the score never goes below zero', () => {
  const state = play(newWordle('medium', seeded(55)), fillers(newWordle('medium', seeded(55)), 6))
  assert.ok(state.score >= 0)
})

/* ---- final score ------------------------------------------------- */

test('elapsedSeconds stops at the moment the game ended', () => {
  const won = { ...newWordle('easy', seeded(61)), startedAt: 0, wonAt: 90_000 }
  assert.equal(elapsedSeconds(won), 90)

  const lost = { ...newWordle('easy', seeded(61)), startedAt: 0, lostAt: 45_000 }
  assert.equal(elapsedSeconds(lost), 45)

  const running = newWordle('easy', seeded(61))
  assert.ok(elapsedSeconds(running) >= 0)
})

test('the time bonus rewards a fast win, within limits', () => {
  const won = { ...newWordle('easy', seeded(62)), score: 1000, startedAt: 0, wonAt: 200_000 }
  assert.equal(timeBonus(won), Math.floor(120_000 / 200))

  const capped = { ...won, wonAt: 20_000 }
  assert.equal(timeBonus(capped), 900, 'the bonus is capped')

  const instant = { ...won, wonAt: 19_000 }
  assert.equal(timeBonus(instant), 0, 'under 20 seconds earns nothing')
})

test('a loss or an unfinished game earns no time bonus', () => {
  const lost = { ...newWordle('hard', seeded(63)), score: 500, startedAt: 0, lostAt: 200_000 }
  assert.equal(timeBonus(lost), 0)
  assert.equal(finalScore(lost), Math.round(500 * DIFFICULTY_BONUS.hard))

  const running = { ...newWordle('hard', seeded(63)), score: 500, startedAt: 0 }
  assert.equal(timeBonus(running), 0)
})

test('the difficulty multiplier scales the final score', () => {
  const easy = { ...newWordle('easy', seeded(64)), score: 1000, startedAt: 0, wonAt: 200_000 }
  const bonus = 600
  assert.equal(timeBonus(easy), bonus)
  assert.equal(finalScore(easy), Math.round((1000 + bonus) * DIFFICULTY_BONUS.easy))

  const medium = { ...easy, difficulty: 'medium' as const }
  const hard = { ...easy, difficulty: 'hard' as const }
  assert.equal(finalScore(medium), Math.round((1000 + bonus) * DIFFICULTY_BONUS.medium))
  assert.equal(finalScore(hard), Math.round((1000 + bonus) * DIFFICULTY_BONUS.hard))
  assert.ok(finalScore(hard) > finalScore(medium) && finalScore(medium) > finalScore(easy))
})
