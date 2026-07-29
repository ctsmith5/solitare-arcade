import { Card, RANK_LABEL, SUIT_COLOR, SUIT_SYMBOL, Suit } from '../game/types'
import '../styles/card.css'

/**
 * Pip layout tables, in fractional coordinates of the central pip area.
 * x: 0 = left column, 0.5 = centre column, 1 = right column.
 * y: 0 = top of the pip area, 1 = bottom.
 * Real playing cards rotate every pip below the midpoint, which we do too.
 */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.5, 0],
    [0.5, 1],
  ],
  3: [
    [0.5, 0],
    [0.5, 0.5],
    [0.5, 1],
  ],
  4: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  5: [
    [0, 0],
    [1, 0],
    [0.5, 0.5],
    [0, 1],
    [1, 1],
  ],
  6: [
    [0, 0],
    [1, 0],
    [0, 0.5],
    [1, 0.5],
    [0, 1],
    [1, 1],
  ],
  7: [
    [0, 0],
    [1, 0],
    [0.5, 0.25],
    [0, 0.5],
    [1, 0.5],
    [0, 1],
    [1, 1],
  ],
  8: [
    [0, 0],
    [1, 0],
    [0.5, 0.25],
    [0, 0.5],
    [1, 0.5],
    [0.5, 0.75],
    [0, 1],
    [1, 1],
  ],
  9: [
    [0, 0],
    [1, 0],
    [0, 1 / 3],
    [1, 1 / 3],
    [0.5, 0.5],
    [0, 2 / 3],
    [1, 2 / 3],
    [0, 1],
    [1, 1],
  ],
  10: [
    [0, 0],
    [1, 0],
    [0.5, 1 / 6],
    [0, 1 / 3],
    [1, 1 / 3],
    [0, 2 / 3],
    [1, 2 / 3],
    [0.5, 5 / 6],
    [0, 1],
    [1, 1],
  ],
}

/** Court-card motifs, drawn inline so the deck needs no image assets. */
function CourtMotif({ rank, suit }: { rank: 11 | 12 | 13; suit: Suit }) {
  const stroke = SUIT_COLOR[suit] === 'red' ? '#a8202f' : '#1b1b22'
  const fill = SUIT_COLOR[suit] === 'red' ? '#d9455a' : '#3b3b46'

  if (rank === 13) {
    // King — a five-point crown on a banded base.
    return (
      <svg className="card-motif" viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M6 28 L4 12 L13 19 L20 8 L27 19 L36 12 L34 28 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <rect x="6" y="29" width="28" height="5" rx="1.4" fill={fill} stroke={stroke} strokeWidth="1.4" />
        <circle cx="4" cy="11" r="2.2" fill={stroke} />
        <circle cx="20" cy="7" r="2.4" fill={stroke} />
        <circle cx="36" cy="11" r="2.2" fill={stroke} />
      </svg>
    )
  }

  if (rank === 12) {
    // Queen — a tiara with a rising fan.
    return (
      <svg className="card-motif" viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M20 6 C13 14 9 18 6 20 C11 22 15 26 20 34 C25 26 29 22 34 20 C31 18 27 14 20 6 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M20 12 C17 18 15 20 13 21 C16 23 18 25 20 29 C22 25 24 23 27 21 C25 20 23 18 20 12 Z" fill="#fdfcf7" opacity="0.72" />
        <circle cx="20" cy="20" r="2.4" fill={stroke} />
      </svg>
    )
  }

  // Jack — a pennant on a staff.
  return (
    <svg className="card-motif" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="18.6" y="5" width="2.8" height="30" rx="1.2" fill={stroke} />
      <path d="M21.4 7 L35 12.5 L21.4 18 Z" fill={fill} stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M18.6 10 L7 14.5 L18.6 19 Z" fill={fill} stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" opacity="0.75" />
      <circle cx="20" cy="4" r="2.6" fill={fill} stroke={stroke} strokeWidth="1.2" />
    </svg>
  )
}

/** The mirrored half of a court card — used twice, rotated. */
function CourtHalf({ rank, suit }: { rank: 11 | 12 | 13; suit: Suit }) {
  return (
    // Caption sits on the outer edge so the two mirrored motifs meet at the
    // centre rule, the way a real court card is printed.
    <div className="card-court-half">
      <div className="card-court-caption">
        <span className="card-court-letter">{RANK_LABEL[rank]}</span>
        <span className="card-court-suit">{SUIT_SYMBOL[suit]}</span>
      </div>
      <CourtMotif rank={rank} suit={suit} />
    </div>
  )
}

function CornerIndex({ card, corner }: { card: Card; corner: 'tl' | 'br' }) {
  const label = RANK_LABEL[card.rank]
  return (
    <div className={`card-index card-index-${corner}`}>
      {/* "10" is condensed so it clears the left pip column, as on a real deck. */}
      <span className={`card-index-rank ${label.length > 1 ? 'is-wide' : ''}`}>{label}</span>
      <span className="card-index-suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  )
}

export function CardBack() {
  return (
    <div className="card-back">
      <div className="card-back-frame">
        <div className="card-back-pattern" />
        <div className="card-back-emblem">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path
              d="M20 4 L27 13 L36 20 L27 27 L20 36 L13 27 L4 20 L13 13 Z"
              fill="none"
              stroke="rgba(190,215,255,0.85)"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="20" cy="20" r="4.4" fill="none" stroke="rgba(190,215,255,0.85)" strokeWidth="1.6" />
          </svg>
        </div>
      </div>
    </div>
  )
}

export function CardFace({ card }: { card: Card }) {
  if (!card.faceUp) return <CardBack />

  const color = SUIT_COLOR[card.suit]
  const symbol = SUIT_SYMBOL[card.suit]
  const isCourt = card.rank >= 11

  return (
    <div className={`card-face card-${color}`}>
      <CornerIndex card={card} corner="tl" />
      <CornerIndex card={card} corner="br" />

      {isCourt ? (
        <div className="card-court">
          <CourtHalf rank={card.rank as 11 | 12 | 13} suit={card.suit} />
          <div className="card-court-rule" />
          <CourtHalf rank={card.rank as 11 | 12 | 13} suit={card.suit} />
        </div>
      ) : (
        <div className="card-center">
          <div className={`card-pips ${card.rank === 1 ? 'is-ace' : ''}`}>
            {PIPS[card.rank].map(([x, y], i) => (
              <span
                key={i}
                className="card-pip"
                style={{
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  // Lower-half pips are printed upside down on a real card.
                  transform: `translate(-50%, -50%) rotate(${y > 0.5 ? 180 : 0}deg)`,
                }}
              >
                {symbol}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
