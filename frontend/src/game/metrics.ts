import { useEffect, useState } from 'react'
import { Card } from './types'

export interface CardMetrics {
  cardW: number
  cardH: number
  /** Vertical gap between stacked face-up cards. */
  fan: number
  /** Tighter gap used for face-down cards. */
  fanDown: number
}

const FALLBACK: CardMetrics = { cardW: 92, cardH: 128, fan: 26, fanDown: 13 }

function readMetrics(): CardMetrics {
  if (typeof window === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const num = (name: string, fallback: number) => {
    const value = parseFloat(style.getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }
  return {
    cardW: num('--card-w', FALLBACK.cardW),
    cardH: num('--card-h', FALLBACK.cardH),
    fan: num('--fan', FALLBACK.fan),
    fanDown: num('--fan-down', FALLBACK.fanDown),
  }
}

/**
 * Card geometry lives in CSS (so media queries can rescale the table) but the
 * layout maths needs the numbers, so we read them back and watch for resizes.
 */
export function useCardMetrics(): CardMetrics {
  const [metrics, setMetrics] = useState<CardMetrics>(readMetrics)

  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setMetrics(readMetrics()))
    }
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
    }
  }, [])

  return metrics
}

/** Top offset, in pixels, of every card in a tableau column. */
export function stackOffsets(pile: Card[], metrics: CardMetrics): number[] {
  const offsets: number[] = []
  let y = 0
  for (const card of pile) {
    offsets.push(y)
    y += card.faceUp ? metrics.fan : metrics.fanDown
  }
  return offsets
}

/** How many waste cards to fan out, and by how much horizontally. */
export const WASTE_VISIBLE = 3
export const wasteSpread = (metrics: CardMetrics): number => Math.round(metrics.cardW * 0.24)
