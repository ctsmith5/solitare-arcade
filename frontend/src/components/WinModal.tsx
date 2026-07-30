import { useEffect, useMemo } from 'react'
import { Leaderboard } from './Leaderboard'
import { formatTime } from './Game'

interface Props {
  score: number
  timeBonusPoints: number
  total: number
  moves: number
  seconds: number
  playerName: string
  difficultyLabel: string
  bonus: number
  submitState: 'idle' | 'saving' | 'saved' | 'error'
  submitError: string | null
  /** True when this run replaced the player's stored best for the game. */
  isPersonalBest?: boolean
  headline?: string
  blurb?: string
  movesLabel?: string
  onPlayAgain: () => void
  onExit: () => void
}

const SPARK_COLORS = ['#00f0ff', '#ff2e97', '#ffd400', '#39ff14', '#a855f7']

export function WinModal({
  score,
  timeBonusPoints,
  total,
  moves,
  seconds,
  playerName,
  difficultyLabel,
  bonus,
  submitState,
  submitError,
  isPersonalBest = false,
  headline = 'YOU WIN!',
  blurb,
  movesLabel = 'Moves',
  onPlayAgain,
  onExit,
}: Props) {
  // Confetti specks, positioned once so they don't jump between renders.
  const sparks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        color: SPARK_COLORS[i % SPARK_COLORS.length],
        delay: `${Math.random() * 2.4}s`,
        duration: `${2.6 + Math.random() * 2.2}s`,
      })),
    [],
  )

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <>
      {sparks.map((spark) => (
        <span
          key={spark.id}
          className="spark"
          style={{
            left: spark.left,
            background: spark.color,
            animationDelay: spark.delay,
            animationDuration: spark.duration,
          }}
        />
      ))}

      <div className="overlay">
        <div className="panel modal">
          <div className="title-sup">CONGRATULATIONS</div>
          <h2 className="win-title">{headline}</h2>
          <p>{blurb ?? `${playerName} CLEARED THE TABLE — ALL 52 CARDS HOME`}</p>

          <div className="final-stats">
            <div className="final-stat big">
              <span className="k">Final Score</span>
              <span className="v">{total}</span>
            </div>
            <div className="final-stat">
              <span className="k">Mode</span>
              <span className="v">
                {difficultyLabel} <span className="mode-bonus">x{bonus}</span>
              </span>
            </div>
            <div className="final-stat">
              <span className="k">Base</span>
              <span className="v">{score}</span>
            </div>
            <div className="final-stat">
              <span className="k">Time Bonus</span>
              <span className="v">{timeBonusPoints}</span>
            </div>
            <div className="final-stat">
              <span className="k">Time</span>
              <span className="v">{formatTime(seconds)}</span>
            </div>
            <div className="final-stat">
              <span className="k">{movesLabel}</span>
              <span className="v">{moves}</span>
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
            <Leaderboard limit={5} highlightName={playerName} refreshKey={submitState} />
          </div>

          <div className="modal-actions">
            <button className="btn btn-yellow" onClick={onPlayAgain}>
              Play Again
            </button>
            <button className="btn" onClick={onExit}>
              Main Menu
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
