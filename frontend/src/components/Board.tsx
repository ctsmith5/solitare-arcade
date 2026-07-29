import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  CardMetrics,
  stackOffsets,
  WASTE_VISIBLE,
  wasteSpread,
} from '../game/metrics'
import { GameState, PileId, SUITS, SUIT_SYMBOL } from '../game/types'
import { DragState, dropAttr } from '../game/useDrag'
import { CardBack } from './CardFace'
import { CardView } from './Card'

interface Props {
  state: GameState
  metrics: CardMetrics
  drag: DragState | null
  hintIds: string[]
  /** Cards that just turned face up — they get a one-shot flip animation. */
  flippedIds: string[]
  onCardPointerDown: (event: ReactPointerEvent<HTMLDivElement>, pile: PileId, index: number) => void
  onCardDoubleClick: (pile: PileId, index: number) => void
  onStockClick: () => void
}

/** True when this exact card is one of the cards riding the pointer. */
function isDragged(drag: DragState | null, cardId: string): boolean {
  return !!drag?.payload.cards.some((c) => c.id === cardId)
}

function isDropTarget(drag: DragState | null, pile: PileId): boolean {
  const target = drag?.target
  if (!target || target.kind !== pile.kind) return false
  return 'index' in target && 'index' in pile && target.index === pile.index
}

export function Board({
  state,
  metrics,
  drag,
  hintIds,
  flippedIds,
  onCardPointerDown,
  onCardDoubleClick,
  onStockClick,
}: Props) {
  const spread = wasteSpread(metrics)
  const wasteStart = Math.max(0, state.waste.length - WASTE_VISIBLE)
  const wasteCards = state.waste.slice(wasteStart)

  return (
    <div className="table">
      <div className="table-inner">
        {/* ---- stock / waste / foundations ---- */}
        <div className="top-row">
          {/* Stock */}
          <div className="pile">
            <div className="pile-slot" onClick={onStockClick} role="button" aria-label="Stock pile">
              {state.stock.length > 0 ? (
                <>
                  {/* A couple of offset backs give the deck some depth. */}
                  {state.stock.length > 2 && (
                    <div className="card" style={{ top: -3, left: -3, zIndex: 1 }}>
                      <CardBack />
                    </div>
                  )}
                  {state.stock.length > 1 && (
                    <div className="card" style={{ top: -1.5, left: -1.5, zIndex: 2 }}>
                      <CardBack />
                    </div>
                  )}
                  <div className="card playable" style={{ top: 0, left: 0, zIndex: 3 }}>
                    <CardBack />
                  </div>
                </>
              ) : (
                <div className="slot-ghost recycle" title="Recycle the waste pile">
                  {state.waste.length > 0 ? '↻' : '✦'}
                </div>
              )}
            </div>
            <StockCount count={state.stock.length} />
          </div>

          {/* Waste */}
          <div
            className="pile"
            style={{ width: metrics.cardW + spread * (WASTE_VISIBLE - 1) }}
          >
            <div className="pile-slot" style={{ width: metrics.cardW + spread * (WASTE_VISIBLE - 1) }}>
              {state.waste.length === 0 && <div className="slot-ghost">◇</div>}
              {wasteCards.map((card, i) => {
                const absoluteIndex = wasteStart + i
                const isTop = absoluteIndex === state.waste.length - 1
                return (
                  <CardView
                    key={card.id}
                    card={card}
                    left={i * spread}
                    zIndex={i + 1}
                    playable={isTop}
                    dimmed={isDragged(drag, card.id)}
                    hint={hintIds.includes(card.id)}
                    flipIn={flippedIds.includes(card.id)}
                    onPointerDown={
                      isTop
                        ? (event) => onCardPointerDown(event, { kind: 'waste' }, absoluteIndex)
                        : undefined
                    }
                    onDoubleClick={
                      isTop ? () => onCardDoubleClick({ kind: 'waste' }, absoluteIndex) : undefined
                    }
                  />
                )
              })}
            </div>
          </div>

          <div className="spacer" />

          {/* Foundations, one locked slot per suit. */}
          {SUITS.map((suit, index) => {
            const pileId: PileId = { kind: 'foundation', index }
            const pile = state.foundations[index]
            const top = pile[pile.length - 1]
            const beneath = pile[pile.length - 2]
            return (
              <div
                key={suit}
                className={`pile ${isDropTarget(drag, pileId) ? 'drop-ok' : ''}`}
              >
                <div className="pile-slot" data-drop={dropAttr(pileId)}>
                  <div className="drop-halo" />
                  {pile.length === 0 && <div className="slot-ghost">{SUIT_SYMBOL[suit]}</div>}
                  {beneath && <CardView card={beneath} zIndex={1} />}
                  {top && (
                    <CardView
                      card={top}
                      zIndex={2}
                      playable
                      dimmed={isDragged(drag, top.id)}
                      onPointerDown={(event) => onCardPointerDown(event, pileId, pile.length - 1)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ---- tableau ---- */}
        <div className="tableau-row">
          {state.tableau.map((pile, index) => {
            const pileId: PileId = { kind: 'tableau', index }
            const offsets = stackOffsets(pile, metrics)
            const height =
              pile.length > 0
                ? offsets[offsets.length - 1] + metrics.cardH
                : metrics.cardH

            return (
              <div
                key={index}
                className={`pile tableau-pile ${isDropTarget(drag, pileId) ? 'drop-ok' : ''}`}
                data-drop={dropAttr(pileId)}
                style={{ height: Math.max(height, metrics.cardH + metrics.fan * 5) }}
              >
                <div className="drop-halo" />
                {pile.length === 0 && <div className="slot-ghost">K</div>}
                {pile.map((card, cardIndex) => (
                  <CardView
                    key={card.id}
                    card={card}
                    top={offsets[cardIndex]}
                    zIndex={cardIndex + 1}
                    playable={card.faceUp}
                    dimmed={isDragged(drag, card.id)}
                    hint={hintIds.includes(card.id)}
                    flipIn={flippedIds.includes(card.id)}
                    onPointerDown={
                      card.faceUp
                        ? (event) => onCardPointerDown(event, pileId, cardIndex)
                        : undefined
                    }
                    onDoubleClick={
                      card.faceUp ? () => onCardDoubleClick(pileId, cardIndex) : undefined
                    }
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StockCount({ count }: { count: number }) {
  return (
    <div
      style={{
        marginTop: 8,
        textAlign: 'center',
        fontSize: 8,
        letterSpacing: '0.2em',
        color: 'rgba(255,255,255,0.55)',
      }}
    >
      {String(count).padStart(2, '0')}
    </div>
  )
}
