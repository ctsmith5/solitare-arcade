import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Player, api } from '../api/client'
import {
  DIFFICULTIES,
  autoCompleteStep,
  canAutoComplete,
  canDrop as engineCanDrop,
  dealFor,
  drawFromStock,
  elapsedSeconds,
  finalScore,
  findAutoMove,
  grabbableCards,
  hasProductiveMove,
  isDeadEnd,
  moveCards,
  samePile,
  timeBonus,
} from '../game/engine'
import { useCardMetrics } from '../game/metrics'
import { sfx } from '../game/sound'
import { Card, Difficulty, DragPayload, GameState, PileId } from '../game/types'
import { useDrag } from '../game/useDrag'
import { Board } from './Board'
import { DragLayer } from './DragLayer'
import { GameOverModal } from './GameOverModal'
import { WinModal } from './WinModal'

interface Props {
  player: Player
  difficulty: Difficulty
  onExit: () => void
}

const HISTORY_LIMIT = 120

export function Game({ player, difficulty, onExit }: Props) {
  const spec = DIFFICULTIES[difficulty]
  const metrics = useCardMetrics()
  const [state, setState] = useState<GameState>(() => dealFor(difficulty))
  const [history, setHistory] = useState<GameState[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [hintIds, setHintIds] = useState<string[]>([])
  const [flipped, setFlipped] = useState<string[]>([])
  const [muted, setMuted] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  /** Set when the player accepts the "no way forward" prompt. */
  const [conceded, setConceded] = useState(false)
  const [stallDismissed, setStallDismissed] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [scoreBump, setScoreBump] = useState(false)

  const submitted = useRef(false)
  const faceUpSeen = useRef<Set<string>>(new Set())
  const prevScore = useRef(0)

  /*
   * Mirrors `state` so event handlers can read the latest game without being
   * rebuilt, and so transitions never have to run side effects inside a
   * setState updater (StrictMode invokes those twice).
   */
  const stateRef = useRef(state)
  stateRef.current = state

  const won = state.wonAt !== null

  /* ---- clock ---------------------------------------------------- */
  useEffect(() => {
    if (won) return
    const id = window.setInterval(() => setElapsed(elapsedSeconds(state)), 1000)
    return () => window.clearInterval(id)
  }, [state, won])

  /* ---- flash newly revealed cards ------------------------------- */
  useEffect(() => {
    const now = new Set<string>()
    const collect = (cards: Card[]) => {
      for (const card of cards) if (card.faceUp) now.add(card.id)
    }
    collect(state.waste)
    state.tableau.forEach(collect)
    state.foundations.forEach(collect)

    const newly = [...now].filter((id) => !faceUpSeen.current.has(id))
    faceUpSeen.current = now
    if (newly.length === 0) return

    setFlipped(newly)
    const id = window.setTimeout(() => setFlipped([]), 300)
    return () => window.clearTimeout(id)
  }, [state])

  /* ---- score bump ------------------------------------------------ */
  useEffect(() => {
    if (state.score > prevScore.current) {
      setScoreBump(true)
      const id = window.setTimeout(() => setScoreBump(false), 400)
      prevScore.current = state.score
      return () => window.clearTimeout(id)
    }
    prevScore.current = state.score
  }, [state.score])

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 1600)
  }, [])

  /** Applies a state transition, recording the previous state for undo. */
  const commit = useCallback((next: GameState | null, onSuccess?: () => void) => {
    if (!next) return false
    const prev = stateRef.current
    stateRef.current = next
    setHistory((h) => [...h, prev].slice(-HISTORY_LIMIT))
    setState(next)
    onSuccess?.()
    return true
  }, [])

  /* ---- drag and drop --------------------------------------------- */

  const { drag, begin } = useDrag({
    grab: (pile, index) => grabbableCards(stateRef.current, pile, index),
    canDrop: (payload: DragPayload, target) => {
      if (samePile(payload.from, target)) return false
      return engineCanDrop(stateRef.current, payload.cards, target)
    },
    onDrop: (payload, target) => {
      const next = moveCards(stateRef.current, payload.from, payload.fromIndex, target)
      if (!commit(next, target.kind === 'foundation' ? sfx.foundation : sfx.place)) {
        sfx.invalid()
      }
    },
    onPickUp: sfx.pickUp,
    onMiss: sfx.invalid,
    onTap: (pile, index) => {
      // A press that never moved: treat foundation-bound cards as a shortcut.
      const target = findAutoMove(stateRef.current, pile, index)
      if (target?.kind === 'foundation') {
        commit(moveCards(stateRef.current, pile, index, target), sfx.foundation)
      }
    },
  })

  const handleCardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, pile: PileId, index: number) => {
      sfx.unlock()
      setHintIds([])
      begin(event, pile, index)
    },
    [begin],
  )

  const handleDoubleClick = useCallback(
    (pile: PileId, index: number) => {
      const target = findAutoMove(stateRef.current, pile, index)
      if (!target) {
        sfx.invalid()
        return
      }
      commit(
        moveCards(stateRef.current, pile, index, target),
        target.kind === 'foundation' ? sfx.foundation : sfx.place,
      )
    },
    [commit],
  )

  const handleStock = useCallback(() => {
    sfx.unlock()
    setHintIds([])
    const recycling = state.stock.length === 0
    if (recycling && state.waste.length === 0) {
      sfx.invalid()
      return
    }
    commit(drawFromStock(state), recycling ? sfx.recycle : sfx.deal)
    if (recycling) flash('-100  DECK RECYCLED')
  }, [commit, flash, state])

  const handleUndo = useCallback(() => {
    if (history.length === 0 || won) return
    const previous = history[history.length - 1]
    stateRef.current = previous
    setState(previous)
    setHistory((h) => h.slice(0, -1))
    sfx.undo()
  }, [history, won])

  const handleNewGame = useCallback(() => {
    submitted.current = false
    faceUpSeen.current = new Set()
    prevScore.current = 0
    const fresh = dealFor(difficulty)
    stateRef.current = fresh
    setState(fresh)
    setHistory([])
    setElapsed(0)
    setSubmitState('idle')
    setSubmitError(null)
    setAutoRunning(false)
    setConceded(false)
    setStallDismissed(false)
    sfx.coin()
  }, [difficulty])

  /* ---- hint ------------------------------------------------------- */
  const handleHint = useCallback(() => {
    const current = stateRef.current
    const sources: Array<{ pile: PileId; index: number }> = []
    if (current.waste.length > 0) {
      sources.push({ pile: { kind: 'waste' }, index: current.waste.length - 1 })
    }
    current.tableau.forEach((pile, i) => {
      pile.forEach((card, j) => {
        if (card.faceUp) sources.push({ pile: { kind: 'tableau', index: i }, index: j })
      })
    })

    for (const source of sources) {
      const target = findAutoMove(current, source.pile, source.index)
      if (target) {
        const cards = grabbableCards(current, source.pile, source.index)
        if (cards) {
          setHintIds(cards.map((c) => c.id))
          window.setTimeout(() => setHintIds([]), 1500)
          sfx.select()
          return
        }
      }
    }
    flash(current.stock.length > 0 ? 'NO MOVES — DRAW A CARD' : 'NO MOVES FOUND')
    sfx.invalid()
  }, [flash])

  /* ---- auto-complete ---------------------------------------------- */
  const autoAvailable = useMemo(() => canAutoComplete(state), [state])

  useEffect(() => {
    if (!autoRunning) return
    const id = window.setInterval(() => {
      const next = autoCompleteStep(stateRef.current)
      if (!next) {
        setAutoRunning(false)
        return
      }
      stateRef.current = next
      setState(next)
      sfx.foundation()
    }, 90)
    return () => window.clearInterval(id)
  }, [autoRunning])

  /* ---- dead ends ---------------------------------------------------- */

  /** Proven: not a single legal move remains, now or after any redeal. */
  const dead = useMemo(
    () => !won && !autoRunning && isDeadEnd(state),
    [state, won, autoRunning],
  )

  /**
   * Moves exist but none advance the game — a run sliding between two columns,
   * a king hopping between empty slots. Offered as a prompt rather than forced,
   * because this is a next-move heuristic, not a proof the deal is lost.
   */
  const stalled = useMemo(
    () => !won && !autoRunning && !dead && !hasProductiveMove(state),
    [state, won, autoRunning, dead],
  )

  // A fresh source of progress (usually an undo) clears the prompt again.
  useEffect(() => {
    if (!stalled) setStallDismissed(false)
  }, [stalled])

  const gameOver = !won && (dead || conceded)

  /* ---- win + score submission ------------------------------------- */
  const total = finalScore(state)

  /** Banks the run exactly once, whether it ended in a win or a dead end. */
  const submitRun = useCallback(
    (points: number, didWin: boolean) => {
      if (submitted.current) return
      submitted.current = true
      setSubmitState('saving')
      api
        .submitScore({
          player_id: player.id,
          score: points,
          moves: stateRef.current.moves,
          duration_seconds: elapsedSeconds(stateRef.current),
          won: didWin,
          difficulty,
        })
        .then(() => setSubmitState('saved'))
        .catch((error: Error) => {
          setSubmitState('error')
          setSubmitError(error.message)
        })
    },
    [player.id, difficulty],
  )

  useEffect(() => {
    if (!won || submitted.current) return
    setAutoRunning(false)
    sfx.win()
    submitRun(finalScore(stateRef.current), true)
  }, [won, submitRun])

  useEffect(() => {
    if (!gameOver || submitted.current) return
    setAutoRunning(false)
    sfx.gameOver()
    submitRun(stateRef.current.score, false)
  }, [gameOver, submitRun])

  /* ---- quitting ---------------------------------------------------- */
  const confirmExit = useCallback(async () => {
    // An abandoned run still banks its points, like leaving a cabinet mid-game.
    if (!submitted.current && state.score > 0) {
      submitted.current = true
      try {
        await api.submitScore({
          player_id: player.id,
          score: state.score,
          moves: state.moves,
          duration_seconds: elapsedSeconds(state),
          won: false,
          difficulty,
        })
      } catch {
        /* Losing an abandoned score is not worth blocking the exit. */
      }
    }
    onExit()
  }, [onExit, player.id, state, difficulty])

  /* ---- keyboard shortcuts ------------------------------------------ */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          handleUndo()
        }
        return
      }
      switch (event.key.toLowerCase()) {
        case ' ':
        case 'd':
          event.preventDefault()
          handleStock()
          break
        case 'u':
          handleUndo()
          break
        case 'h':
          handleHint()
          break
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleStock, handleUndo, handleHint])

  const displaySeconds = won ? elapsedSeconds(state) : elapsed

  return (
    <div className="game">
      <div className="hud">
        <div className="hud-stats">
          <Stat label="Player" value={player.name} className="player" />
          <div className="stat">
            <span className="stat-label">Mode</span>
            <span className={`stat-value mode diff-${difficulty}`}>
              {spec.label} <span className="mode-bonus">x{spec.bonus}</span>
            </span>
          </div>
          <Stat label="Score" value={String(state.score).padStart(5, '0')} className={`score ${scoreBump ? 'score-bump' : ''}`} />
          <Stat label="Time" value={formatTime(displaySeconds)} />
          <Stat label="Moves" value={String(state.moves).padStart(3, '0')} />
          <Stat label="Passes" value={String(state.passes)} />
        </div>

        <div className="hud-actions">
          {autoAvailable && !autoRunning && (
            <button className="btn btn-yellow btn-sm blink" onClick={() => setAutoRunning(true)}>
              ▶ Auto Finish
            </button>
          )}
          <button className="btn btn-sm" onClick={handleHint} disabled={won}>
            Hint
          </button>
          <button className="btn btn-sm" onClick={handleUndo} disabled={history.length === 0 || won}>
            ↶ Undo
          </button>
          <button className="btn btn-sm" onClick={handleNewGame}>
            New Deal
          </button>
          <button
            className={`btn btn-sm ${muted ? 'btn-off' : ''}`}
            onClick={() => {
              const next = !muted
              setMuted(next)
              sfx.setMuted(next)
              if (!next) sfx.select()
            }}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound is off' : 'Sound is on'}
          >
            <SpeakerIcon muted={muted} />
          </button>
          <button className="btn btn-magenta btn-sm" onClick={() => setConfirmQuit(true)}>
            Exit
          </button>
        </div>
      </div>

      <Board
        state={state}
        metrics={metrics}
        drag={drag}
        hintIds={hintIds}
        flippedIds={flipped}
        onCardPointerDown={handleCardPointerDown}
        onCardDoubleClick={handleDoubleClick}
        onStockClick={handleStock}
      />

      <DragLayer drag={drag} metrics={metrics} />

      {toast && <div className="toast">{toast}</div>}

      {won && (
        <WinModal
          score={state.score}
          timeBonusPoints={timeBonus(state)}
          total={total}
          moves={state.moves}
          seconds={elapsedSeconds(state)}
          playerName={player.name}
          difficultyLabel={spec.label}
          bonus={spec.bonus}
          submitState={submitState}
          submitError={submitError}
          onPlayAgain={handleNewGame}
          onExit={onExit}
        />
      )}

      {gameOver && (
        <GameOverModal
          proven={dead}
          score={state.score}
          moves={state.moves}
          seconds={elapsedSeconds(state)}
          playerName={player.name}
          difficultyLabel={spec.label}
          bonus={spec.bonus}
          submitState={submitState}
          submitError={submitError}
          onNewDeal={handleNewGame}
          onExit={onExit}
        />
      )}

      {stalled && !stallDismissed && !gameOver && (
        <div className="overlay">
          <div className="panel modal">
            <h2 className="neon-yellow">NO WAY FORWARD</h2>
            <p>
              There are still legal moves, but none of them
              <br />
              uncover a card, free a column, or bank a card.
              <br />
              <br />
              Undo may open something up — otherwise this deal is done.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStallDismissed(true)}>
                Keep Playing
              </button>
              <button
                className="btn"
                onClick={() => {
                  setStallDismissed(true)
                  handleUndo()
                }}
                disabled={history.length === 0}
              >
                ↶ Undo
              </button>
              <button className="btn btn-magenta" onClick={() => setConceded(true)}>
                End Game
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmQuit && (
        <div className="overlay" onClick={() => setConfirmQuit(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="neon-magenta">LEAVE GAME?</h2>
            <p>
              Your current score of {state.score} will be banked
              <br />
              to the leaderboard as an unfinished run.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmQuit(false)}>
                Keep Playing
              </button>
              <button className="btn btn-magenta" onClick={confirmExit}>
                Exit to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Speaker drawn on a 16x16 pixel grid so it sits alongside the bitmap font
 * instead of fighting it. Blocks only — no curves, no anti-aliasing.
 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      className="pixel-icon"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* cabinet, then the cone stepping outward one pixel at a time */}
      <rect x="2" y="6" width="3" height="4" />
      <rect x="5" y="5" width="1" height="6" />
      <rect x="6" y="4" width="1" height="8" />
      <rect x="7" y="3" width="1" height="10" />

      {muted ? (
        // A 4x4 cross where the sound would be.
        <>
          {[0, 1, 2, 3].map((i) => (
            <rect key={`a${i}`} x={9 + i} y={5 + i} width="1" height="1" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <rect key={`b${i}`} x={12 - i} y={5 + i} width="1" height="1" />
          ))}
        </>
      ) : (
        // Two stepped arcs radiating out.
        <>
          <rect x="9" y="6" width="1" height="4" />
          <rect x="11" y="4" width="1" height="8" />
        </>
      )}
    </svg>
  )
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className}`}>{value}</span>
    </div>
  )
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
