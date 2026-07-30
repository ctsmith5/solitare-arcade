import { useState } from 'react'
import { Player } from './api/client'
import { Game } from './components/Game'
import { MainMenu } from './components/MainMenu'
import type { GameKey } from './game/difficulty'
import { SudokuGame } from './components/SudokuGame'
import { WordleGame } from './components/WordleGame'
import type { Difficulty } from './game/types'
import './styles/arcade.css'
import './styles/sudoku.css'
import './styles/wordle.css'

interface Session {
  player: Player
  game: GameKey
  difficulty: Difficulty
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  return (
    <div className="cabinet">
      <div className="crt-overlay" />
      <div className="screen">
        {!session ? (
          <MainMenu
            onStart={(player, game, difficulty) => setSession({ player, game, difficulty })}
          />
        ) : session.game === 'wordle' ? (
          <WordleGame
            key={`wordle-${session.player.id}-${session.difficulty}`}
            player={session.player}
            difficulty={session.difficulty}
            onExit={() => setSession(null)}
          />
        ) : session.game === 'sudoku' ? (
          <SudokuGame
            key={`sudoku-${session.player.id}-${session.difficulty}`}
            player={session.player}
            difficulty={session.difficulty}
            onExit={() => setSession(null)}
          />
        ) : (
          // Remounting per player and difficulty guarantees a fresh deal.
          <Game
            key={`solitaire-${session.player.id}-${session.difficulty}`}
            player={session.player}
            difficulty={session.difficulty}
            onExit={() => setSession(null)}
          />
        )}
      </div>
    </div>
  )
}
