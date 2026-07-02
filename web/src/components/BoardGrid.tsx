import type { BoardConfig } from '../board/config'
import { columnLabel } from '../board/geometry'
import type { HoldAssignment, HoldType } from '../types'
import { holdColor } from '../types'

interface BoardGridProps {
  board: BoardConfig
  holds: HoldAssignment[]
  onToggle: (col: number, row: number) => void
}

/** With beta off the grid cycles empty → start → move (blue "right") → end → empty. */
export const CYCLE: (HoldType | null)[] = [null, 'start', 'right', 'end']

/** Next role in the tap cycle for a cell's current role. */
export function nextType(current: HoldType | null): HoldType | null {
  const i = CYCLE.findIndex((t) => t === current)
  return CYCLE[(i + 1) % CYCLE.length]
}

export function BoardGrid({ board, holds, onToggle }: BoardGridProps) {
  const byCell = new Map(holds.map((h) => [`${h.col}-${h.row}`, h.type]))

  // Render rows top (row = board.rows) down to bottom (row = 1).
  const rows = Array.from({ length: board.rows }, (_, i) => board.rows - i)
  const cols = Array.from({ length: board.cols }, (_, i) => i)

  return (
    <div
      className="board-grid"
      style={{ gridTemplateColumns: `auto repeat(${board.cols}, 1fr)` }}
    >
      {rows.map((row) => (
        <div className="board-row" key={row} style={{ display: 'contents' }}>
          <div className="row-label">{row}</div>
          {cols.map((col) => {
            const type = byCell.get(`${col}-${row}`) ?? null
            return (
              <button
                key={col}
                className="cell"
                aria-label={`${columnLabel(col)}${row}`}
                style={type ? { background: holdColor[type], borderColor: holdColor[type] } : undefined}
                onClick={() => onToggle(col, row)}
              />
            )
          })}
        </div>
      ))}
      <div className="corner" />
      {cols.map((col) => (
        <div className="col-label" key={col}>
          {columnLabel(col)}
        </div>
      ))}
    </div>
  )
}
