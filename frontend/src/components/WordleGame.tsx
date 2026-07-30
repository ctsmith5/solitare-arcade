import { useCallback, useEffect, useRef, useState } from 'react'
import { Player, api } from '../api/client'
import { DIFFICULTY_BONUS, DIFFICULTY_LABEL } from '../game/difficulty'
import { sfx } from '../game/sound'
import type { Difficulty } from '../game/types'
import {
  elapsedSeconds,
  finalScore,
  hardModeViolation,
  isValidGuess,
  newWordle,
  submitGuess,
  timeBonus,
} from '../game/wordle'
import type { WordleState } from '../game/wordle'
import { WORD_LENGTH } from '../game/words'
import { Leaderboard } from './Leaderboard'
import { WinModal } from './WinModal'
import { WordleBoard, WordleKeyboard } from './WordleBoard'
import { formatTime } from './Game'

interface Props {
  player: Player
  difficulty: Difficulty
  onExit: () => void
}

export function WordleGame({ player, difficulty, onExit }: Props) {
  const [state, setState] = useState<WordleState>(() => newWordle(difficulty))
  const [current, setCurrent] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPersonalBest, setIsPersonalBest] = useState(false)

  const submitted = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const currentRef = useRef(current)
  currentRef.current = current

  const won = state.wonAt !== null
  const lost = state.lostAt !== null
  const over = won || lost
  const bonus = DIFFICULTY_BONUS[difficulty]

  useEffect(() => {
    if (over) return
    const id = window.setInterval(() => setElapsed(elapsedSeconds(stateRef.current)), 1000)
    return () => window.clearInterval(id)
  }, [over])

  const reject = useCallback((reason: string) => {
    setMessage(reason)
    setShake(true)
    sfx.invalid()
    window.setTimeout(() => setShake(false), 420)
    window.setTimeout(() => setMessage((m) => (m === reason ? null : m)), 1800)
  }, [])

  const handleEnter = useCallback(() => {
    const guess = currentRef.current
    const game = stateRef.current
    if (over) return

    if (guess.length < WORD_LENGTH) {
      reject('NOT ENOUGH LETTERS')
      return
    }
    if (!isValidGuess(guess)) {
      reject('NOT IN WORD LIST')
      return
    }
    const violation = hardModeViolation(game, guess)
    if (violation) {
      reject(violation.toUpperCase())
      return
    }

    const next = submitGuess(game, guess)
    if (!next) {
      reject('NOT IN WORD LIST')
      return
    }
    stateRef.current = next
    setState(next)
    setCurrent('')
    if (next.wonAt) sfx.win()
    else if (next.lostAt) sfx.gameOver()
    else sfx.place()
  }, [over, reject])

  const handleKey = useCallback(
    (letter: string) => {
      if (over) return
      sfx.unlock()
      setCurrent((c) => (c.length >= WORD_LENGTH ? c : c + letter))
    },
    [over],
  )

  const handleBackspace = useCallback(() => {
    if (over) return
    setCurrent((c) => c.slice(0, -1))
  }, [over])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Enter') {
        event.preventDefault()
        handleEnter()
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        handleBackspace()
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        handleKey(event.key.toLowerCase())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleEnter, handleBackspace, handleKey])

  const handleNewWord = useCallback(() => {
    submitted.current = false
    const fresh = newWordle(difficulty)
    stateRef.current = fresh
    setState(fresh)
    setCurrent('')
    setMessage(null)
    setElapsed(0)
    setSubmitState('idle')
    setSubmitError(null)
    setIsPersonalBest(false)
    sfx.coin()
  }, [difficulty])

  /* ---- score submission -------------------------------------------- */
  const bank = useCallback(
    (didWin: boolean) => {
      if (submitted.current) return
      submitted.current = true
      const game = stateRef.current
      setSubmitState('saving')
      api
        .submitScore({
          player_id: player.id,
          game: 'wordle',
          score: finalScore(game),
          moves: game.guesses.length,
          duration_seconds: elapsedSeconds(game),
          won: didWin,
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
    },
    [player.id, difficulty],
  )

  useEffect(() => {
    if (over) bank(won)
  }, [over, won, bank])

  const confirmExit = useCallback(async () => {
    if (!submitted.current && stateRef.current.score > 0) {
      submitted.current = true
      const game = stateRef.current
      try {
        await api.submitScore({
          player_id: player.id,
          game: 'wordle',
          score: finalScore(game),
          moves: game.guesses.length,
          duration_seconds: elapsedSeconds(game),
          won: false,
          difficulty,
        })
      } catch {
        /* An abandoned score is not worth blocking the exit. */
      }
    }
    onExit()
  }, [onExit, player.id, difficulty])

  const displaySeconds = over ? elapsedSeconds(state) : elapsed

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
          <Stat
            label="Tries"
            value={`${state.guesses.length}/${state.maxGuesses}`}
          />
          {state.hardMode && <Stat label="Rule" value="HARD" />}
        </div>

        <div className="hud-actions">
          <button className="btn btn-sm" onClick={handleNewWord}>
            New Word
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

      <div className="wordle-table">
        <div className="wordle-inner">
          <WordleBoard state={state} current={current} shake={shake} />
          <div className="wordle-message">{message}</div>
          <WordleKeyboard
            keyboard={state.keyboard}
            disabled={over}
            onKey={handleKey}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
          />
        </div>
      </div>

      {won && (
        <WinModal
          score={state.score}
          timeBonusPoints={timeBonus(state)}
          total={finalScore(state)}
          moves={state.guesses.length}
          seconds={elapsedSeconds(state)}
          playerName={player.name}
          difficultyLabel={DIFFICULTY_LABEL[difficulty]}
          bonus={bonus}
          submitState={submitState}
          submitError={submitError}
          isPersonalBest={isPersonalBest}
          headline="GOT IT!"
          blurb={`${player.name} FOUND ${state.answer.toUpperCase()} IN ${state.guesses.length}`}
          movesLabel="Guesses"
          onPlayAgain={handleNewWord}
          onExit={onExit}
        />
      )}

      {lost && (
        <div className="overlay">
          <div className="panel modal modal-over">
            <div className="title-sup over-sup">OUT OF TRIES</div>
            <h2 className="over-title">SO CLOSE</h2>
            <p>
              THE WORD WAS
              <br />
              <span className="wordle-answer">{state.answer.toUpperCase()}</span>
            </p>

            <div className="final-stats">
              <div className="final-stat big over">
                <span className="k">Final Score</span>
                <span className="v">{finalScore(state)}</span>
              </div>
              <div className="final-stat">
                <span className="k">Mode</span>
                <span className="v">
                  {DIFFICULTY_LABEL[difficulty]} <span className="mode-bonus">x{bonus}</span>
                </span>
              </div>
              <div className="final-stat">
                <span className="k">Time</span>
                <span className="v">{formatTime(elapsedSeconds(state))}</span>
              </div>
            </div>

            <div className={`status-line ${submitState === 'error' ? 'error' : ''}`}>
              {submitState === 'saving' && <span className="blink">SAVING SCORE…</span>}
              {submitState === 'saved' &&
                (isPersonalBest ? (
                  <span className="neon-yellow blink">★ NEW PERSONAL BEST ★</span>
                ) : (
                  <span className="neon-green">SCORE BANKED — YOUR BEST STANDS</span>
                ))}
              {submitState === 'error' && <span>COULD NOT SAVE — {submitError}</span>}
            </div>

            <div style={{ margin: '4px 0 18px' }}>
              <Leaderboard limit={5} highlightName={player.name} refreshKey={submitState} />
            </div>

            <div className="modal-actions">
              <button className="btn btn-yellow" onClick={handleNewWord}>
                New Word
              </button>
              <button className="btn" onClick={onExit}>
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmQuit && (
        <div className="overlay" onClick={() => setConfirmQuit(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="neon-magenta">GIVE UP?</h2>
            <p>
              Your score of {state.score} will be offered
              <br />
              to the leaderboard as an unfinished run.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmQuit(false)}>
                Keep Guessing
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
