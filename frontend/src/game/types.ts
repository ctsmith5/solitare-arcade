export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Color = 'black' | 'red'

/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export interface Card {
  /** Stable identity for the whole game, e.g. "hearts-12". */
  id: string
  suit: Suit
  rank: Rank
  faceUp: boolean
}

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

export const SUIT_COLOR: Record<Suit, Color> = {
  spades: 'black',
  clubs: 'black',
  hearts: 'red',
  diamonds: 'red',
}

export const RANK_LABEL: Record<Rank, string> = {
  1: 'A',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
}

export const colorOf = (card: Card): Color => SUIT_COLOR[card.suit]

/** Where a card lives on the table. */
export type PileId =
  | { kind: 'stock' }
  | { kind: 'waste' }
  | { kind: 'foundation'; index: number } // 0-3, indexed to match SUITS
  | { kind: 'tableau'; index: number } // 0-6

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface GameState {
  /** Which band this shuffle was dealt from; drives the score multiplier. */
  difficulty: Difficulty
  stock: Card[]
  waste: Card[]
  /** Four piles, one per suit, in SUITS order. */
  foundations: Card[][]
  /** Seven columns, left to right. */
  tableau: Card[][]
  score: number
  moves: number
  /** How many times the stock has been recycled from the waste. */
  passes: number
  startedAt: number
  /** Set once every card reaches a foundation. */
  wonAt: number | null
}

/** A card being carried by the pointer, plus where it came from. */
export interface DragPayload {
  cards: Card[]
  from: PileId
  /** Index of the grabbed card within its source pile. */
  fromIndex: number
}
