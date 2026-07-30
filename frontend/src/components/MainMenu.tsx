import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, Player, api } from '../api/client'
import { DIFFICULTY_BLURB, GAMES, GAME_ORDER } from '../game/difficulty'
import type { GameKey } from '../game/difficulty'
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../game/engine'
import { sfx } from '../game/sound'
import type { Difficulty } from '../game/types'
import { Leaderboard } from './Leaderboard'

interface Props {
  onStart: (player: Player, game: GameKey, difficulty: Difficulty) => void
}

export function MainMenu({ onStart }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Player | null>(null)
  const [newName, setNewName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [game, setGame] = useState<GameKey>('solitaire')
  const inputRef = useRef<HTMLInputElement>(null)

  const loadPlayers = useCallback(() => {
    setLoadError(null)
    api
      .listPlayers()
      .then(setPlayers)
      .catch((error: Error) => {
        setPlayers([])
        setLoadError(error.message)
      })
  }, [])

  useEffect(loadPlayers, [loadPlayers, refreshKey])

  const handleSelect = (player: Player) => {
    sfx.unlock()
    sfx.select()
    setSelected(player)
    setFormError(null)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    sfx.unlock()

    const name = newName.trim()
    if (!name) {
      setFormError('ENTER A NAME FIRST')
      inputRef.current?.focus()
      return
    }

    setCreating(true)
    setFormError(null)
    try {
      const player = await api.createPlayer(name)
      sfx.coin()
      setNewName('')
      setSelected(player)
      setRefreshKey((k) => k + 1)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'COULD NOT CREATE PLAYER'
      setFormError(message)
      sfx.invalid()
    } finally {
      setCreating(false)
    }
  }

  const handleStart = () => {
    if (!selected) return
    sfx.coin()
    onStart(selected, game, difficulty)
  }

  return (
    <div className="menu">
      <div className="menu-inner">
      <div className="title-block">
        <div className="title-sup">ANTHROPIC ARCADE PRESENTS</div>
        <h1 className="title">ARCADE</h1>
        <div className="title-sub">{GAMES[game].tagline}</div>
      </div>

      <div className="menu-columns">
        {/* ---- player select ---- */}
        <div className="panel">
          <div className="panel-head">
            <span>SELECT PLAYER</span>
            <span className="neon-magenta">{players?.length ?? 0} ON FILE</span>
          </div>
          <div className="panel-body">
            {players === null ? (
              <div className="status-line">
                <span className="blink">READING CABINET…</span>
              </div>
            ) : players.length === 0 ? (
              <div className="empty-note">
                NO PLAYERS YET
                <br />
                <span className="neon-yellow">CREATE ONE BELOW</span>
              </div>
            ) : (
              <div className="player-list">
                {players.map((player) => (
                  <button
                    key={player.id}
                    className={`player-row ${selected?.id === player.id ? 'selected' : ''}`}
                    onClick={() => handleSelect(player)}
                    onDoubleClick={() => {
                      handleSelect(player)
                      sfx.coin()
                      onStart(player, game, difficulty)
                    }}
                  >
                    <span className="cursor">{selected?.id === player.id ? '▶' : ''}</span>
                    <span className="pname">{player.name}</span>
                    <span className="pbest">{String(player.total_score ?? 0).padStart(5, '0')}</span>
                  </button>
                ))}
              </div>
            )}

            {loadError && <div className="form-error">{loadError}</div>}

            <form className="name-form" onSubmit={handleCreate}>
              <input
                ref={inputRef}
                className="arcade-input"
                value={newName}
                maxLength={12}
                placeholder="NEW PLAYER"
                onChange={(e) => setNewName(e.target.value.toUpperCase())}
                aria-label="New player name"
              />
              <button className="btn btn-sm" type="submit" disabled={creating}>
                {creating ? '…' : 'ADD'}
              </button>
            </form>
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-error" style={{ color: 'var(--ink-dim)' }}>
              1–12 CHARS · A–Z 0–9 SPACE - _ · NO PASSWORD
            </div>
          </div>
        </div>

        {/* ---- leaderboard ---- */}
        <div className="panel">
          <div className="panel-head">
            <span className="neon-yellow">★ TOP 5 · COMBINED TOTAL ★</span>
          </div>
          <div className="panel-body">
            <Leaderboard limit={5} highlightName={selected?.name} refreshKey={refreshKey} />
          </div>
        </div>
      </div>

      <div className="panel difficulty-panel">
        <div className="panel-head">
          <span>SELECT GAME</span>
          <span className="neon-cyan">{GAMES[game].title}</span>
        </div>
        <div className="game-options">
          {GAME_ORDER.map((key) => (
            <button
              key={key}
              className={`game-option game-${key} ${game === key ? 'selected' : ''}`}
              onClick={() => {
                sfx.select()
                setGame(key)
              }}
              aria-pressed={game === key}
            >
              <span className="game-title">{GAMES[key].title}</span>
              <span className="game-tagline">{GAMES[key].tagline}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel difficulty-panel">
        <div className="panel-head">
          <span>DIFFICULTY</span>
          <span className="neon-green">
            SCORE x{DIFFICULTIES[difficulty].bonus}
          </span>
        </div>
        <div className="difficulty-options">
          {DIFFICULTY_ORDER.map((key) => {
            const spec = DIFFICULTIES[key]
            return (
              <button
                key={key}
                className={`difficulty-option diff-${key} ${difficulty === key ? 'selected' : ''}`}
                onClick={() => {
                  sfx.select()
                  setDifficulty(key)
                }}
                aria-pressed={difficulty === key}
              >
                <span className="diff-label">{spec.label}</span>
                <span className="diff-bonus">x{spec.bonus}</span>
                <span className="diff-blurb">{DIFFICULTY_BLURB[game][key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="menu-actions">
        <button className="btn btn-yellow" onClick={handleStart} disabled={!selected}>
          {selected ? `▶ START ${GAMES[game].title} — ${selected.name}` : 'SELECT A PLAYER TO START'}
        </button>
        <div className="insert-coin blink">{selected ? 'PRESS START' : 'INSERT COIN'}</div>
        <div className="credit-line">
          {game === 'solitaire'
            ? 'DRAG CARDS · DOUBLE-CLICK TO SEND HOME · H FOR HINT'
            : game === 'sudoku'
              ? 'CLICK A CELL · 1-9 TO FILL · N FOR NOTES · H FOR HINT'
              : 'TYPE A WORD · ENTER TO GUESS · GREEN RIGHT · YELLOW MISPLACED'}
        </div>
      </div>
      </div>
    </div>
  )
}
