import { useCallback, useEffect, useRef, useState } from 'react'
import { Player, api } from '../api/client'
import { DIFFICULTY_BONUS, DIFFICULTY_LABEL } from '../game/difficulty'
import { sfx } from '../game/sound'
import type { Digit } from '../game/sudoku'
import {
  clearCell,
  digitCounts,
  elapsedSeconds,
  finalScore,
  isGiven,
  newSudoku,
  placeDigit,
  remaining,
  timeBonus,
  toggleNote,
  useHint,
} from '../game/sudokuGame'
import type { SudokuState } from '../game/sudokuGame'
import type { Difficulty } from '../game/types'
import { SudokuBoard } from './SudokuBoard'
import { WinModal } from './WinModal'
import { formatTime } from './Game'

interface Props {
  player: Player
  difficulty: Difficulty
  onExit: () => void
}

const HISTORY_LIMIT = 200
const DIGITS: Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export function SudokuGame({ player, difficulty, onExit }: Props) {
  const [state, setState] = useState<SudokuState>(() => newSudoku(difficulty))
  const [history, setHistory] = useState<SudokuState[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPersonalBest, setIsPersonalBest] = useState(false)

  const submitted = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const won = state.wonAt !== null
  const bonus = DIFFICULTY_BONUS[difficulty]

  /* ---- clock ------------------------------------------------------ */
  useEffect(() => {
    if (won) return
    const id = window.setInterval(() => setElapsed(elapsedSeconds(stateRef.current)), 1000)
    return () => window.clearInterval(id)
  }, [won])

  /** Applies a transition, recording the previous state for undo. */
  const commit = useCallback((next: SudokuState | null, onSuccess?: () => void) => {
    if (!next) return false
    const prev = stateRef.current
    stateRef.current = next
    setHistory((h) => [...h, prev].slice(-HISTORY_LIMIT))
    setState(next)
    onSuccess?.()
    return true
  }, [])

  const enterDigit = useCallback(
    (digit: Digit) => {
      if (selected === null || won) return
      const current = stateRef.current
      if (isGiven(current, selected)) {
        sfx.invalid()
        return
      }

      if (noteMode) {
        commit(toggleNote(current, selected, digit), sfx.select)
        return
      }

      const wasCorrect = digit === current.solution[selected]
      if (!commit(placeDigit(current, selected, digit), wasCorrect ? sfx.place : sfx.invalid)) {
        sfx.invalid()
      }
    },
    [commit, noteMode, selected, won],
  )

  const erase = useCallback(() => {
    if (selected === null || won) return
    if (!commit(clearCell(stateRef.current, selected), sfx.undo)) sfx.invalid()
  }, [commit, selected, won])

  const handleHint = useCallback(() => {
    if (won) return
    if (!commit(useHint(stateRef.current), sfx.foundation)) sfx.invalid()
  }, [commit, won])

  const handleUndo = useCallback(() => {
    if (history.length === 0 || won) return
    const previous = history[history.length - 1]
    stateRef.current = previous
    setState(previous)
    setHistory((h) => h.slice(0, -1))
    sfx.undo()
  }, [history, won])

  const handleNewPuzzle = useCallback(() => {
    submitted.current = false
    const fresh = newSudoku(difficulty)
    stateRef.current = fresh
    setState(fresh)
    setHistory([])
    setSelected(null)
    setElapsed(0)
    setSubmitState('idle')
    setSubmitError(null)
    setIsPersonalBest(false)
    sfx.coin()
  }, [difficulty])

  /* ---- keyboard --------------------------------------------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        handleUndo()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key >= '1' && event.key <= '9') {
        enterDigit(Number(event.key) as Digit)
        return
      }

      switch (event.key) {
        case 'Backspace':
        case 'Delete':
        case '0':
          event.preventDefault()
          erase()
          break
        case 'n':
        case 'N':
          setNoteMode((v) => !v)
          break
        case 'h':
        case 'H':
          handleHint()
          break
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault()
          setSelected((current) => {
            const from = current ?? 0
            const delta =
              event.key === 'ArrowUp' ? -9 : event.key === 'ArrowDown' ? 9 : event.key === 'ArrowLeft' ? -1 : 1
            // Left/right must not wrap across a row edge.
            if (delta === -1 && from % 9 === 0) return from
            if (delta === 1 && from % 9 === 8) return from
            const next = from + delta
            return next >= 0 && next < 81 ? next : from
          })
          break
        }
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enterDigit, erase, handleHint, handleUndo])

  /* ---- score submission -------------------------------------------- */
  useEffect(() => {
    if (!won || submitted.current) return
    submitted.current = true
    sfx.win()
    setSubmitState('saving')

    const current = stateRef.current
    api
      .submitScore({
        player_id: player.id,
        game: 'sudoku',
        score: finalScore(current),
        moves: current.mistakes,
        duration_seconds: elapsedSeconds(current),
        won: true,
        difficulty,
      })
      .then((result) => {
        setIsPersonalBest(result.personal_best)
        setSubmitState('saved')
      })
      .catch((error: Error) => {
        setSubmitState('error')
        setSubmitError(error.message)
      })
  }, [won, player.id, difficulty])

  const confirmExit = useCallback(async () => {
    const current = stateRef.current
    if (!submitted.current && current.score > 0) {
      submitted.current = true
      try {
        await api.submitScore({
          player_id: player.id,
          game: 'sudoku',
          score: finalScore(current),
          moves: current.mistakes,
          duration_seconds: elapsedSeconds(current),
          won: false,
          difficulty,
        })
      } catch {
        /* An abandoned score is not worth blocking the exit. */
      }
    }
    onExit()
  }, [onExit, player.id, difficulty])

  const counts = digitCounts(state)
  const displaySeconds = won ? elapsedSeconds(state) : elapsed

  return (
    <div className="game">
      <div className="hud">
        <div className="hud-stats">
          <Stat label="Player" value={player.name} className="player" />
          <div className="stat">
            <span className="stat-label">Mode</span>
            <span className={`stat-value mode diff-${difficulty}`}>
              {DIFFICULTY_LABEL[difficulty]} <span className="mode-bonus">x{bonus}</span>
            </span>
          </div>
          <Stat label="Score" value={String(state.score).padStart(5, '0')} className="score" />
          <Stat label="Time" value={formatTime(displaySeconds)} />
          <Stat label="Left" value={String(remaining(state)).padStart(2, '0')} />
          <Stat label="Mistakes" value={String(state.mistakes)} />
        </div>

        <div className="hud-actions">
          <button
            className={`btn btn-sm ${noteMode ? 'btn-yellow' : ''}`}
            onClick={() => setNoteMode((v) => !v)}
            aria-pressed={noteMode}
            title="Pencil marks (N)"
          >
            ✎ Notes {noteMode ? 'On' : 'Off'}
          </button>
          <button className="btn btn-sm" onClick={handleHint} disabled={won}>
            Hint −75
          </button>
          <button className="btn btn-sm" onClick={handleUndo} disabled={history.length === 0 || won}>
            ↶ Undo
          </button>
          <button className="btn btn-sm" onClick={handleNewPuzzle}>
            New Puzzle
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
          >
            <SpeakerIcon muted={muted} />
          </button>
          <button className="btn btn-magenta btn-sm" onClick={() => setConfirmQuit(true)}>
            Exit
          </button>
        </div>
      </div>

      <div className="sudoku-table">
        <div className="sudoku-inner">
          <SudokuBoard
            state={state}
            selected={selected}
            onSelect={(i) => {
              sfx.unlock()
              setSelected(i)
            }}
          />

          <div className="sudoku-pad">
            {DIGITS.map((d) => (
              <button
                key={d}
                className={`pad-key ${counts[d] >= 9 ? 'done' : ''}`}
                onClick={() => enterDigit(d)}
                disabled={won}
              >
                <span className="pad-digit">{d}</span>
                <span className="pad-left">{Math.max(0, 9 - counts[d])}</span>
              </button>
            ))}
            <button className="pad-key wide" onClick={erase} disabled={won}>
              <span className="pad-digit">⌫</span>
            </button>
          </div>
        </div>
      </div>

      {won && (
        <WinModal
          score={state.score}
          timeBonusPoints={timeBonus(state)}
          total={finalScore(state)}
          moves={state.mistakes}
          seconds={elapsedSeconds(state)}
          playerName={player.name}
          difficultyLabel={DIFFICULTY_LABEL[difficulty]}
          bonus={bonus}
          submitState={submitState}
          submitError={submitError}
          isPersonalBest={isPersonalBest}
          headline="PUZZLE SOLVED!"
          blurb={`${player.name} FILLED ALL 81 CELLS`}
          movesLabel="Mistakes"
          onPlayAgain={handleNewPuzzle}
          onExit={onExit}
        />
      )}

      {confirmQuit && (
        <div className="overlay" onClick={() => setConfirmQuit(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="neon-magenta">LEAVE PUZZLE?</h2>
            <p>
              Your score of {state.score} will be offered
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

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className}`}>{value}</span>
    </div>
  )
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="pixel-icon" viewBox="0 0 16 16" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      <rect x="2" y="6" width="3" height="4" />
      <rect x="5" y="5" width="1" height="6" />
      <rect x="6" y="4" width="1" height="8" />
      <rect x="7" y="3" width="1" height="10" />
      {muted ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <rect key={`a${i}`} x={9 + i} y={5 + i} width="1" height="1" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <rect key={`b${i}`} x={12 - i} y={5 + i} width="1" height="1" />
          ))}
        </>
      ) : (
        <>
          <rect x="9" y="6" width="1" height="4" />
          <rect x="11" y="4" width="1" height="8" />
        </>
      )}
    </svg>
  )
}
