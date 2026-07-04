// Placement of the hold grid within a board-art image, ported from
// `MoonBoardGeometry` in ios/MoonBoardLED/Board/MoonBoardSetup.swift. This is the
// RENDERING geometry (where to draw hold markers on the art) and is distinct from
// web/src/board/geometry.ts, which is the LED serpentine geometry for hardware.

export interface RenderGeometry {
  /** 11 (A–K) for every current layout. */
  numColumns: number
  /** Highest row number, drawn at the top slot. */
  rowTop: number
  /** Vertical slots, counting down from rowTop. */
  numRows: number
  /** Board-art pixel size (used for aspect ratio). */
  width: number
  height: number
  /** Fractions (0–1) of the hold grid inset within the image. */
  leftMargin: number
  rightMargin: number
  topMargin: number
  bottomMargin: number
}

/** Image aspect ratio (width / height). */
export function aspect(g: RenderGeometry): number {
  return g.width / g.height
}

/**
 * Center of a hold as fractions (0–1) of the image. `col` 0–10 (A–K, left→right),
 * `row` 1 = bottom. Row 1 renders at the bottom via the `rowTop - row` flip.
 */
export function center(g: RenderGeometry, col: number, row: number): { x: number; y: number } {
  const gridW = 1 - g.leftMargin - g.rightMargin
  const gridH = 1 - g.topMargin - g.bottomMargin
  const x = g.leftMargin + ((col + 0.5) / g.numColumns) * gridW
  const slotFromTop = g.rowTop - row
  const y = g.topMargin + ((slotFromTop + 0.5) / g.numRows) * gridH
  return { x, y }
}

export const STANDARD_GEOMETRY: RenderGeometry = {
  numColumns: 11, rowTop: 18, numRows: 18, width: 650, height: 1000,
  leftMargin: 0.1, rightMargin: 0.05, topMargin: 0.06, bottomMargin: 0.04,
}

export const MINI_GEOMETRY: RenderGeometry = {
  numColumns: 11, rowTop: 12, numRows: 12, width: 650, height: 694,
  leftMargin: 0.1047, rightMargin: 0.0508, topMargin: 0.0793, bottomMargin: 0.0571,
}
