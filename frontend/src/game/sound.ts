/**
 * Tiny WebAudio blip engine — every sound is synthesised, so the game ships
 * with no audio assets.
 */

type Voice = 'square' | 'triangle' | 'sawtooth' | 'sine'

let ctx: AudioContext | null = null
let muted = false

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  // Browsers start the context suspended until a user gesture.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface Blip {
  freq: number
  /** Slides to this frequency across the note if given. */
  to?: number
  duration: number
  voice?: Voice
  gain?: number
  /** Seconds to wait before playing. */
  delay?: number
}

function play({ freq, to, duration, voice = 'square', gain = 0.06, delay = 0 }: Blip) {
  const context = audio()
  if (!context || muted) return

  const start = context.currentTime + delay
  const osc = context.createOscillator()
  const amp = context.createGain()

  osc.type = voice
  osc.frequency.setValueAtTime(freq, start)
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration)

  // Quick attack, exponential decay — reads as a cabinet blip.
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(amp).connect(context.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export const sfx = {
  setMuted(value: boolean) {
    muted = value
  },
  isMuted: () => muted,

  /** Called on the first user gesture so the context is unlocked. */
  unlock() {
    audio()
  },

  pickUp: () => play({ freq: 420, to: 620, duration: 0.07, voice: 'triangle', gain: 0.05 }),
  place: () => play({ freq: 300, to: 180, duration: 0.09, voice: 'square', gain: 0.05 }),
  deal: () => play({ freq: 700, to: 420, duration: 0.06, voice: 'triangle', gain: 0.04 }),
  flip: () => play({ freq: 880, to: 1320, duration: 0.07, voice: 'square', gain: 0.045 }),
  invalid: () => play({ freq: 150, to: 90, duration: 0.16, voice: 'sawtooth', gain: 0.05 }),

  foundation() {
    play({ freq: 660, duration: 0.09, voice: 'square', gain: 0.05 })
    play({ freq: 990, duration: 0.11, voice: 'square', gain: 0.045, delay: 0.07 })
  },

  recycle() {
    play({ freq: 260, to: 130, duration: 0.22, voice: 'sawtooth', gain: 0.05 })
  },

  undo: () => play({ freq: 520, to: 300, duration: 0.1, voice: 'triangle', gain: 0.045 }),

  select: () => play({ freq: 780, duration: 0.05, voice: 'square', gain: 0.045 }),

  coin() {
    play({ freq: 988, duration: 0.07, voice: 'square', gain: 0.05 })
    play({ freq: 1319, duration: 0.28, voice: 'square', gain: 0.05, delay: 0.06 })
  },

  /** Descending three-note sting for a dead end. */
  gameOver() {
    const notes = [392, 311, 233]
    notes.forEach((freq, i) =>
      play({ freq, duration: 0.24, voice: 'square', gain: 0.05, delay: i * 0.17 }),
    )
    play({ freq: 116, duration: 0.85, voice: 'triangle', gain: 0.05, delay: notes.length * 0.17 })
  },

  /** Rising arpeggio fanfare for a completed game. */
  win() {
    const notes = [523, 659, 784, 1047, 1319, 1568]
    notes.forEach((freq, i) => {
      play({ freq, duration: 0.16, voice: 'square', gain: 0.055, delay: i * 0.11 })
      play({ freq: freq / 2, duration: 0.16, voice: 'triangle', gain: 0.035, delay: i * 0.11 })
    })
    play({ freq: 2093, duration: 0.7, voice: 'square', gain: 0.05, delay: notes.length * 0.11 })
  },
}
