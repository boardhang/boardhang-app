// Serpentine LED mapping. TS port of shared/spec/led-geometry.md
// (from ios/MoonBoardLED/Board/BoardGeometry.swift).
//
// The strip snakes: LED 0 is the bottom of column A, up column A, down column B,
// up column C, and so on. Only the row count differs between board sizes.

export const COLUMNS = 11
export const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

/** Total LEDs for a board with `rows` rows (11 columns). */
export function totalLEDs(rows: number): number {
  return COLUMNS * rows
}

/**
 * LED index (0-based) for a hold at the given column/row.
 * @param col 0…10 (A…K, left → right)
 * @param row 1…rows (1 = bottom)
 * @param rows the board's row count (Mini 12, full 18)
 * @param flipped strip wired/mounted from the opposite end → reverse the whole strip
 */
export function ledIndex(col: number, row: number, rows: number, flipped = false): number {
  const base = col * rows
  const led = col % 2 === 0 ? base + (row - 1) : base + (rows - row)
  return flipped ? totalLEDs(rows) - 1 - led : led
}

/** Reverse mapping: which (col, row) a given LED index lights. */
export function positionForLED(
  led: number,
  rows: number,
  flipped = false,
): { col: number; row: number } | null {
  const total = totalLEDs(rows)
  if (led < 0 || led >= total) return null
  const effective = flipped ? total - 1 - led : led
  const col = Math.floor(effective / rows)
  const offset = effective % rows
  const row = col % 2 === 0 ? offset + 1 : rows - offset
  return { col, row }
}

export function columnLabel(col: number): string {
  return COLUMN_LABELS[col] ?? '?'
}
