import { useEffect, useState } from 'react'
import { LeaderboardEntry, api } from '../api/client'
import { GAMES, GAME_ORDER } from '../game/difficulty'

interface Props {
  limit?: number
  /** Rows for this player get a highlight, like your own initials on a cabinet. */
  highlightName?: string
  /** Change this to force a refetch. */
  refreshKey?: unknown
}

/**
 * The arcade table. Rows are players, not runs: each is ranked on the sum of
 * their best score in every game, with the breakdown shown alongside.
 */
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

  if (error) return <div className="status-line error">{error}</div>

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
            <th className="lb-breakdown-head">Per game</th>
            <th style={{ textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.player_id}
              className={`lb-row lb-row-${entry.rank} ${
                highlightName && entry.player_name === highlightName ? 'is-you' : ''
              }`}
            >
              <td className="lb-rank">{entry.rank}</td>
              <td className="lb-name">{entry.player_name}</td>
              <td className="lb-breakdown">
                {GAME_ORDER.map((key) => {
                  const best = entry.bests?.[key]
                  if (!best) return null
                  return (
                    <span key={key} className={`game-chip game-${key}`} title={GAMES[key].title}>
                      {GAMES[key].short} {best}
                    </span>
                  )
                })}
              </td>
              <td className="lb-score">{String(entry.total_score).padStart(5, '0')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
