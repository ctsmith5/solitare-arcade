import { useState } from 'react'
import { Player } from './api/client'
import { Game } from './components/Game'
import { MainMenu } from './components/MainMenu'
import type { Difficulty } from './game/types'
import './styles/arcade.css'

interface Session {
  player: Player
  difficulty: Difficulty
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  return (
    <div className="cabinet">
      <div className="crt-overlay" />
      <div className="screen">
        {session ? (
          // Remounting per player and difficulty guarantees a fresh deal.
          <Game
            key={`${session.player.id}-${session.difficulty}`}
            player={session.player}
            difficulty={session.difficulty}
            onExit={() => setSession(null)}
          />
        ) : (
          <MainMenu onStart={(player, difficulty) => setSession({ player, difficulty })} />
        )}
      </div>
    </div>
  )
}
