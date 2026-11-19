// Display strings for boards on the boards drawer and the add / edit pages. The
// registry's full names are the source; these only shorten or summarise them.

import type { CatalogBoardDef } from '../board/boards'

/** A board name short enough for a three-per-row tile ("MB 2024", "Mini MB 2025"). */
export function shortBoardName(board: CatalogBoardDef): string {
  return board.name.replace('MoonBoard', 'MB')
}

/** One line describing a setup: "40° · all hold sets" or "25° · 3 of 7 hold sets". */
export function setupSummary(angle: number, selectedHoldSets: number, totalHoldSets: number): string {
  const holdSets =
    selectedHoldSets >= totalHoldSets
      ? 'all hold sets'
      : `${selectedHoldSets} of ${totalHoldSets} hold sets`
  return `${angle}° · ${holdSets}`
}
