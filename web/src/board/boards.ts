// The catalog board registry, ported from ios/MoonBoardLED/Board/Board.swift
// (`Board.all`) and ios/MoonBoardLED/Board/MoonBoardSetup.swift (`MoonBoardSetup.all`).
// This is the set of boards the app supports end-to-end (each has a bundled catalog
// slab). Server catalog rows are partitioned by (layoutId, angle); full boards have
// two slabs (40°/25°), Mini has one.

import type { RenderGeometry } from './renderGeometry'
import { MINI_GEOMETRY, STANDARD_GEOMETRY } from './renderGeometry'

/** A hold set within a board: its stable id, display name, and overlay-art basename. */
export interface HoldSet {
  id: number
  name: string
  /** Asset basename of the overlay PNG under the board's folder (e.g. "holdsetf"). */
  imageName: string
}

export interface CatalogBoardDef {
  /** layout_id — the key server catalog rows are partitioned by. */
  layoutId: number
  name: string
  /** Wall angles with a bundled catalog (e.g. [40] or [40, 25]). */
  angles: number[]
  /** Asset-catalog namespace folder (e.g. "minimoonboard2025"). */
  folder: string
  /** Background-art basename ("moonboard-bg" or "minimoonboard-bg"). */
  background: string
  /** Bundled catalog resource base name. */
  catalogPrefix: string
  /** Bundled hold-set membership resource name. */
  membershipResource: string
  geometry: RenderGeometry
  holdSets: HoldSet[]
}

const set = (id: number, name: string, imageName: string): HoldSet => ({ id, name, imageName })

/**
 * Every board the app supports, in registry order — the catalog of what *can* be
 * added (owned boards are tracked separately). Keyed by `layoutId`.
 */
export const BOARDS: CatalogBoardDef[] = [
  {
    layoutId: 7,
    name: 'Mini MoonBoard 2025',
    angles: [40],
    folder: 'minimoonboard2025',
    background: 'minimoonboard-bg',
    catalogPrefix: 'MiniMoonBoard2025Catalog',
    membershipResource: 'MiniMoonBoard2025HoldSets',
    geometry: MINI_GEOMETRY,
    holdSets: [
      set(28, 'Hold Set F', 'holdsetf'),
      set(29, 'Original School Holds', 'originalschoolholds'),
      set(30, 'Wooden Holds B', 'woodenholdsb'),
      set(31, 'Wooden Holds C', 'woodenholdsc'),
    ],
  },
  {
    layoutId: 5,
    name: 'MoonBoard Masters 2019',
    angles: [40, 25],
    folder: 'moonboardmasters2019',
    background: 'moonboard-bg',
    catalogPrefix: 'MoonBoardMasters2019Catalog',
    membershipResource: 'MoonBoardMasters2019HoldSets',
    geometry: STANDARD_GEOMETRY,
    holdSets: [
      set(17, 'Hold Set A', 'holdseta'),
      set(18, 'Hold Set B', 'holdsetb'),
      set(19, 'Original School Holds', 'originalschoolholds'),
      set(20, 'Screw-on Feet', 'screw-onfeet'),
      set(21, 'Wooden Holds', 'woodenholds'),
      set(22, 'Wooden Holds B', 'woodenholdsb'),
      set(23, 'Wooden Holds C', 'woodenholdsc'),
    ],
  },
  {
    layoutId: 3,
    name: 'MoonBoard 2024',
    angles: [40, 25],
    folder: 'moonboard2024',
    background: 'moonboard-bg',
    catalogPrefix: 'MoonBoard2024Catalog',
    membershipResource: 'MoonBoard2024HoldSets',
    geometry: STANDARD_GEOMETRY,
    holdSets: [
      set(5, 'Hold Set D', 'holdsetd'),
      set(6, 'Hold Set E', 'holdsete'),
      set(7, 'Hold Set F', 'holdsetf'),
      set(8, 'Wooden Holds', 'woodenholds'),
      set(9, 'Wooden Holds B', 'woodenholdsb'),
      set(10, 'Wooden Holds C', 'woodenholdsc'),
    ],
  },
  {
    layoutId: 4,
    name: 'MoonBoard Masters 2017',
    angles: [40, 25],
    folder: 'moonboardmasters2017',
    background: 'moonboard-bg',
    catalogPrefix: 'MoonBoardMasters2017Catalog',
    membershipResource: 'MoonBoardMasters2017HoldSets',
    geometry: STANDARD_GEOMETRY,
    holdSets: [
      set(11, 'Hold Set A', 'holdseta'),
      set(12, 'Hold Set B', 'holdsetb'),
      set(13, 'Hold Set C', 'holdsetc'),
      set(14, 'Original School Holds', 'originalschoolholds'),
      set(15, 'Screw-on Feet', 'screw-onfeet'),
      set(16, 'Wooden Holds', 'woodenholds'),
    ],
  },
  {
    layoutId: 2,
    name: 'MoonBoard 2016',
    angles: [40, 25],
    folder: 'moonboard2016',
    background: 'moonboard-bg',
    catalogPrefix: 'MoonBoard2016Catalog',
    membershipResource: 'MoonBoard2016HoldSets',
    geometry: STANDARD_GEOMETRY,
    holdSets: [
      set(2, 'Hold Set A', 'holdseta'),
      set(3, 'Hold Set B', 'holdsetb'),
      set(4, 'Original School Holds', 'originalschoolholds'),
    ],
  },
]

/** The board a given layout_id maps to, or undefined if unsupported. */
export function boardByLayoutId(layoutId: number): CatalogBoardDef | undefined {
  return BOARDS.find((b) => b.layoutId === layoutId)
}

/** Whether the board offers an angle choice (more than one bundled catalog angle). */
export function hasAngleChoice(board: CatalogBoardDef): boolean {
  return board.angles.length > 1
}

/** The default angle for a board (its first bundled angle). */
export function defaultAngle(board: CatalogBoardDef): number {
  return board.angles[0] ?? 40
}
