import { Leaderboard } from './Leaderboard'
import { formatTime } from './Game'

interface Props {
  /** True when the engine proved no legal move remains. */
  proven: boolean
  score: number
  moves: number
  seconds: number
  playerName: string
  difficultyLabel: string
  bonus: number
  submitState: 'idle' | 'saving' | 'saved' | 'error'
  submitError: string | null
  onNewDeal: () => void
  onExit: () => void
}

export function GameOverModal({
  proven,
  score,
  moves,
  seconds,
  playerName,
  difficultyLabel,
  bonus,
  submitState,
  submitError,
  onNewDeal,
  onExit,
}: Props) {
  return (
    <div className="overlay">
      <div className="panel modal modal-over">
        <div className="title-sup over-sup">GAME OVER</div>
        <h2 className="over-title">NO MOVES LEFT</h2>
        <p>
          {proven ? (
            <>
              EVERY CARD IS BLOCKED
              <br />
              NOTHING LEFT TO DRAW OR PLAY
            </>
          ) : (
            <>
              {playerName} CALLED IT
              <br />
              NO WAY FORWARD FROM HERE
            </>
          )}
        </p>

        <div className="final-stats">
          <div className="final-stat big over">
            <span className="k">Final Score</span>
            <span className="v">{score}</span>
          </div>
          <div className="final-stat">
            <span className="k">Mode</span>
            <span className="v">
              {difficultyLabel} <span className="mode-bonus">x{bonus}</span>
            </span>
          </div>
          <div className="final-stat">
            <span className="k">Time</span>
            <span className="v">{formatTime(seconds)}</span>
          </div>
          <div className="final-stat">
            <span className="k">Moves</span>
            <span className="v">{moves}</span>
          </div>
        </div>

        <div className={`status-line ${submitState === 'error' ? 'error' : ''}`}>
          {submitState === 'saving' && <span className="blink">SAVING SCORE…</span>}
          {submitState === 'saved' && <span className="neon-green">SCORE SAVED TO CABINET</span>}
          {submitState === 'error' && <span>COULD NOT SAVE — {submitError}</span>}
        </div>

        <div style={{ margin: '4px 0 18px' }}>
          <Leaderboard limit={5} highlightName={playerName} refreshKey={submitState} />
        </div>

        <div className="modal-actions">
          <button className="btn btn-yellow" onClick={onNewDeal}>
            New Deal
          </button>
          <button className="btn" onClick={onExit}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  )
}
