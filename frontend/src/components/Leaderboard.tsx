import { useEffect, useState } from 'react'
import { LeaderboardEntry, api } from '../api/client'
import { formatTime } from './Game'

interface Props {
  limit?: number
  /** Rows for this player get a highlight, like your own initials on a cabinet. */
  highlightName?: string
  /** Change this to force a refetch. */
  refreshKey?: unknown
}

export function Leaderboard({ limit = 5, highlightName, refreshKey }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .leaderboard(limit)
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [limit, refreshKey])

  if (error) {
    return <div className="status-line error">{error}</div>
  }

  if (!entries) {
    return (
      <div className="status-line">
        <span className="blink">LOADING HIGH SCORES…</span>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="empty-note">
        NO SCORES YET
        <br />
        <span className="neon-yellow">BE THE FIRST</span>
      </div>
    )
  }

  return (
    <div className="leaderboard">
      <table className="lb-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th title="Difficulty">Mode</th>
            <th style={{ textAlign: 'right' }}>Score</th>
            <th style={{ textAlign: 'right' }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={`${entry.player_id}-${entry.created_at}-${entry.rank}`}
              className={`lb-row lb-row-${entry.rank} ${
                highlightName && entry.player_name === highlightName ? 'is-you' : ''
              }`}
            >
              <td className="lb-rank">{entry.rank}</td>
              <td className="lb-name">
                {entry.player_name}
                {entry.won && <span className="lb-crown" title="Completed game"> ★</span>}
              </td>
              <td className="lb-diff">
                <span className={`diff-chip diff-${entry.difficulty}`}>
                  {entry.difficulty.slice(0, 1).toUpperCase()}
                </span>
              </td>
              <td className="lb-score">{String(entry.score).padStart(5, '0')}</td>
              <td className="lb-time">{formatTime(entry.duration_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
