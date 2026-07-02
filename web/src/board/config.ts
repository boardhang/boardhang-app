// Data-driven board definitions. See shared/spec/data-model.md.
// Geometry differs between boards only by row count, so larger boards drop in
// by adding another entry here.

export interface BoardConfig {
  cols: number
  rows: number
  angle: number
  flipped: boolean
}

export const mini2025: BoardConfig = {
  cols: 11,
  rows: 12,
  angle: 40,
  flipped: false,
}
