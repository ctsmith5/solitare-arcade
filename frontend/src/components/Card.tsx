import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Card } from '../game/types'
import { CardFace } from './CardFace'

interface Props {
  card: Card
  top?: number
  left?: number
  zIndex?: number
  /** Adds the grab cursor — the card can start a drag. */
  playable?: boolean
  /** Ghosted because a copy is currently riding the pointer. */
  dimmed?: boolean
  hint?: boolean
  flipIn?: boolean
  style?: CSSProperties
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
}

export function CardView({
  card,
  top = 0,
  left = 0,
  zIndex = 0,
  playable = false,
  dimmed = false,
  hint = false,
  flipIn = false,
  style,
  onPointerDown,
  onDoubleClick,
}: Props) {
  const classes = [
    'card',
    playable ? 'playable' : '',
    dimmed ? 'dragging-source' : '',
    hint ? 'hint' : '',
    flipIn ? 'flip-in' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      style={{ top, left, zIndex, ...style }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      data-card={card.id}
      aria-label={card.faceUp ? `${card.rank} of ${card.suit}` : 'face down card'}
    >
      <CardFace card={card} />
    </div>
  )
}
