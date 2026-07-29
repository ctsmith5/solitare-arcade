import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, DragPayload, PileId } from './types'

export interface DragState {
  payload: DragPayload
  /** Current pointer position, in viewport coordinates. */
  x: number
  y: number
  /** Where the pointer grabbed the card, relative to the card's top-left. */
  offsetX: number
  offsetY: number
  /** The pile currently under the pointer, if it is a legal destination. */
  target: PileId | null
}

interface Options {
  /** Cards that would travel if this position were grabbed, or null. */
  grab: (pile: PileId, index: number) => Card[] | null
  canDrop: (payload: DragPayload, target: PileId) => boolean
  onDrop: (payload: DragPayload, target: PileId) => void
  /** Fired when a press ends without the pointer ever passing the threshold. */
  onTap?: (pile: PileId, index: number) => void
  onPickUp?: () => void
  /** Released over nothing legal. */
  onMiss?: () => void
}

/** Pointer travel, in px, before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 4

export function dropAttr(pile: PileId): string {
  return 'index' in pile ? `${pile.kind}:${pile.index}` : pile.kind
}

/** Reads the drop zone under a point, seeing through the pointer-less drag layer. */
function pileUnderPoint(x: number, y: number): PileId | null {
  const el = document.elementFromPoint(x, y)
  const zone = el?.closest('[data-drop]')
  if (!zone) return null

  const raw = zone.getAttribute('data-drop') ?? ''
  const [kind, rawIndex] = raw.split(':')
  const index = Number(rawIndex)

  if ((kind === 'foundation' || kind === 'tableau') && Number.isInteger(index)) {
    return { kind, index }
  }
  return null
}

export function useDrag(options: Options) {
  const [drag, setDragState] = useState<DragState | null>(null)

  // Options change every render; a ref keeps the window listeners stable.
  const opts = useRef(options)
  opts.current = options

  /*
   * The live drag also lives in a ref. Reading it there lets pointerup run its
   * side effects (the actual move) outside any state-updater function, which
   * StrictMode would otherwise invoke twice.
   */
  const dragRef = useRef<DragState | null>(null)
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDragState(next)
  }, [])

  // Everything the in-flight gesture needs, without re-rendering on each move.
  const gesture = useRef<{
    pointerId: number
    pile: PileId
    index: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    started: boolean
  } | null>(null)

  const begin = useCallback((event: React.PointerEvent, pile: PileId, index: number) => {
    // Left button / touch / pen only.
    if (event.button !== 0) return
    if (!opts.current.grab(pile, index)) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    gesture.current = {
      pointerId: event.pointerId,
      pile,
      index,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      started: false,
    }
    event.preventDefault()
  }, [])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const g = gesture.current
      if (!g || event.pointerId !== g.pointerId) return

      if (!g.started) {
        const travelled = Math.hypot(event.clientX - g.startX, event.clientY - g.startY)
        if (travelled < DRAG_THRESHOLD) return

        const cards = opts.current.grab(g.pile, g.index)
        if (!cards) {
          gesture.current = null
          return
        }
        g.started = true
        opts.current.onPickUp?.()
        setDrag({
          payload: { cards, from: g.pile, fromIndex: g.index },
          x: event.clientX,
          y: event.clientY,
          offsetX: g.offsetX,
          offsetY: g.offsetY,
          target: null,
        })
        return
      }

      const current = dragRef.current
      if (!current) return
      const over = pileUnderPoint(event.clientX, event.clientY)
      const target = over && opts.current.canDrop(current.payload, over) ? over : null
      setDrag({ ...current, x: event.clientX, y: event.clientY, target })
    }

    const onUp = (event: PointerEvent) => {
      const g = gesture.current
      if (!g || event.pointerId !== g.pointerId) return
      gesture.current = null

      if (!g.started) {
        opts.current.onTap?.(g.pile, g.index)
        return
      }

      const current = dragRef.current
      setDrag(null)
      if (!current) return

      const over = pileUnderPoint(event.clientX, event.clientY)
      if (over && opts.current.canDrop(current.payload, over)) {
        opts.current.onDrop(current.payload, over)
      } else {
        opts.current.onMiss?.()
      }
    }

    const onCancel = () => {
      gesture.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [setDrag])

  return { drag, begin }
}
