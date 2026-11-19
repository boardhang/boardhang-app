// Builds a navigation target for a board's catalog, seeded from its cold-launch
// filters and persisted angle. Shared by the bare-`/` redirect and the nav Search
// button so both reproduce the last-active catalog identically.
//
// Lives here (not in router.tsx) so both the router and the AppLayout shell can
// import it without a router <-> shell import cycle.

import { boardByLayoutId, defaultAngle, type CatalogBoardDef } from '../board/boards'
import { getAngle } from '../board/boardStore'
import { loadSeed } from './filterSeed'
import { CATALOG_SEARCH_DEFAULTS, filtersToSearch } from './catalogSearch'

export { boardByLayoutId }

const CATALOG_PATH = /^\/board\/(\d+)\/catalog\/?$/

/** The layout id of the catalog a pathname points at, or null for any other route. */
export function catalogLayoutId(pathname: string): number | null {
  const match = CATALOG_PATH.exec(pathname)
  return match ? Number(match[1]) : null
}

/** A `navigate`/`redirect` target for a board's catalog. Default params are left
 *  in — the route's strip middleware removes them, keeping the URL clean. */
export function catalogNavTarget(board: CatalogBoardDef) {
  const angle = getAngle(board)
  return {
    to: '/board/$layoutId/catalog' as const,
    params: { layoutId: String(board.layoutId) },
    search: {
      ...CATALOG_SEARCH_DEFAULTS,
      ...filtersToSearch(loadSeed(board.layoutId, angle)),
      angle: angle === defaultAngle(board) ? 0 : angle,
    },
  }
}
