import { boxOf, colOf, findConflicts, rowOf } from '../game/sudoku'
import type { Digit } from '../game/sudoku'
import { isGiven, noteDigits } from '../game/sudokuGame'
import type { SudokuState } from '../game/sudokuGame'

interface Props {
  state: SudokuState
  selected: number | null
  onSelect: (index: number) => void
}

/**
 * The 9x9 grid. Highlighting follows the conventions people expect from a
 * sudoku app: the selected cell's row, column and box are shaded, every copy of
 * the selected digit is picked out, and clashes are flagged in red.
 */
export function SudokuBoard({ state, selected, onSelect }: Props) {
  const conflicts = findConflicts(state.grid)
  const selectedDigit = selected !== null ? state.grid[selected] : 0

  return (
    <div className="sudoku-grid" role="grid" aria-label="Sudoku board">
      {state.grid.map((cell, index) => {
        const given = isGiven(state, index)
        const isSelected = selected === index
        const peer =
          selected !== null &&
          !isSelected &&
          (rowOf(index) === rowOf(selected) ||
            colOf(index) === colOf(selected) ||
            boxOf(index) === boxOf(selected))
        const sameDigit = selectedDigit !== 0 && cell === selectedDigit && !isSelected
        const clashing = conflicts.has(index)
        // A filled cell that disagrees with the solution — the player's own
        // mistake, shown even when nothing else on the board contradicts it yet.
        const wrong = !given && cell !== 0 && cell !== state.solution[index]

        const classes = [
          'sud-cell',
          given ? 'given' : 'entered',
          isSelected ? 'selected' : '',
          peer ? 'peer' : '',
          sameDigit ? 'same-digit' : '',
          clashing || wrong ? 'wrong' : '',
          colOf(index) % 3 === 2 && colOf(index) !== 8 ? 'box-right' : '',
          rowOf(index) % 3 === 2 && rowOf(index) !== 8 ? 'box-bottom' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={index}
            className={classes}
            onClick={() => onSelect(index)}
            role="gridcell"
            aria-label={`row ${rowOf(index) + 1} column ${colOf(index) + 1}${
              cell ? `, ${cell}` : ', empty'
            }`}
          >
            {cell !== 0 ? (
              <span className="sud-digit">{cell}</span>
            ) : state.notes[index] !== 0 ? (
              <span className="sud-notes">
                {([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]).map((d) => (
                  <span key={d} className={noteDigits(state.notes[index]).includes(d) ? 'on' : ''}>
                    {noteDigits(state.notes[index]).includes(d) ? d : ''}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
