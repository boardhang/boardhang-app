// Builds a navigation target for a board's catalog, seeded from its cold-launch
// filters and persisted angle. Shared by the bare-`/` redirect and the nav Search
// button so both reproduce the last-active catalog identically.
//
// Lives here (not in router.tsx) so both the router and the AppLayout shell can
// import it without a router <-> shell import cycle.

import { boardByLayoutId, defaultAngle } from '../board/boards'
import type { BoardInstance } from '../board/boardInstance'
import { getAngle } from '../board/boardStore'
import { loadSeed } from './filterSeed'
import { CATALOG_SEARCH_DEFAULTS, filtersToSearch } from './catalogSearch'

export { boardByLayoutId }

/** A `navigate`/`redirect` target for an instance's catalog. Default params are left
 *  in — the route's strip middleware removes them, keeping the URL clean. */
export function catalogNavTarget(instance: BoardInstance) {
  const angle = getAngle(instance)
  const layout = instance.layout
  return {
    to: '/board/$layoutId/catalog' as const,
    params: { layoutId: String(layout.layoutId) },
    search: {
      ...CATALOG_SEARCH_DEFAULTS,
      ...filtersToSearch(loadSeed(layout.layoutId, angle)),
      angle: angle === defaultAngle(layout) ? 0 : angle,
    },
  }
}
