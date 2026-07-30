import type { LetterMark, WordleState } from '../game/wordle'
import { WORD_LENGTH } from '../game/words'

interface Props {
  state: WordleState
  /** Letters typed but not yet submitted. */
  current: string
  /** Set briefly when a guess is rejected. */
  shake: boolean
}

export function WordleBoard({ state, current, shake }: Props) {
  const rows = Array.from({ length: state.maxGuesses }, (_, row) => row)
  const activeRow = state.guesses.length

  return (
    <div className={`wordle-grid ${shake ? 'shake' : ''}`} role="grid" aria-label="Guesses">
      {rows.map((row) => {
        const scored = state.guesses[row]
        const isActive = row === activeRow
        const letters = scored ? scored.word : isActive ? current : ''

        return (
          <div
            key={row}
            className={`wordle-row ${scored ? 'revealed' : ''} ${isActive ? 'active' : ''}`}
            role="row"
          >
            {Array.from({ length: WORD_LENGTH }, (_, col) => {
              const letter = letters[col] ?? ''
              const mark: LetterMark | undefined = scored?.marks[col]
              return (
                <div
                  key={col}
                  className={`wordle-tile ${mark ?? ''} ${!mark && letter ? 'filled' : ''}`}
                  role="gridcell"
                  aria-label={mark ? `${letter}, ${mark}` : letter || 'empty'}
                >
                  {letter.toUpperCase()}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

interface KeyboardProps {
  keyboard: Record<string, LetterMark>
  disabled: boolean
  onKey: (letter: string) => void
  onEnter: () => void
  onBackspace: () => void
}

export function WordleKeyboard({ keyboard, disabled, onKey, onEnter, onBackspace }: KeyboardProps) {
  return (
    <div className="wordle-keyboard">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className="kb-row">
          {i === 2 && (
            <button className="kb-key wide" onClick={onEnter} disabled={disabled}>
              ENTER
            </button>
          )}
          {[...row].map((letter) => (
            <button
              key={letter}
              className={`kb-key ${keyboard[letter] ?? ''}`}
              onClick={() => onKey(letter)}
              disabled={disabled}
              aria-label={letter}
            >
              {letter.toUpperCase()}
            </button>
          ))}
          {i === 2 && (
            <button
              className="kb-key wide"
              onClick={onBackspace}
              disabled={disabled}
              aria-label="Backspace"
            >
              <BackspaceIcon />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Backspace drawn on a pixel grid. The bitmap font has no glyph for U+232B, so
 * the character renders as a stray dot — same trap as using an emoji.
 */
function BackspaceIcon() {
  return (
    <svg
      className="pixel-icon kb-icon"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Arrow head, stepped one pixel per row. */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={`u${i}`} x={2 + i} y={7 - i} width="1" height={1 + i * 2} />
      ))}
      {/* Body of the key symbol. */}
      <rect x="6" y="3" width="8" height="10" />
      {/* The X, knocked out in the background colour. */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={`x${i}`} x={8 + i} y={5 + i} width="1" height="1" fill="var(--bg-deep)" />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={`y${i}`} x={11 - i} y={5 + i} width="1" height="1" fill="var(--bg-deep)" />
      ))}
    </svg>
  )
}
