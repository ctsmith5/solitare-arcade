import { CardMetrics } from '../game/metrics'
import { DragState } from '../game/useDrag'
import { CardView } from './Card'

/**
 * The cards currently riding the pointer. Rendered in a fixed, pointer-events
 * free layer so hit-testing sees the table underneath.
 */
export function DragLayer({ drag, metrics }: { drag: DragState | null; metrics: CardMetrics }) {
  if (!drag) return null

  const x = drag.x - drag.offsetX
  const y = drag.y - drag.offsetY

  return (
    <div className="drag-layer">
      <div
        className={`drag-stack ${drag.target ? '' : 'invalid'}`}
        style={{ transform: `translate3d(${x}px, ${y}px, 0) rotate(1.5deg)` }}
      >
        {drag.payload.cards.map((card, i) => (
          <CardView key={card.id} card={card} top={i * metrics.fan} zIndex={i + 1} />
        ))}
      </div>
    </div>
  )
}
