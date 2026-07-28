// The two id-shaped inputs the catalog's source facet needs (U6): which authored problems are
// the signed-in user's own, and how recently each authored problem on this slab was touched.
//
// Both live in the user-problems IndexedDB cache, not in `CatalogProblem` — a catalog row
// carries no owner field, and the `user:` prefix alone can't separate own from somebody else's
// public problem. So the predicate takes them through FilterContext, the same shape
// useListMemberIds supplies for the saved-list facet.
//
// `ready` gates the predicate: until the first read resolves, an active Mine/Community facet
// fails OPEN (the list is never blanked mid-load). It only ever flips true — a board/angle
// switch re-reads over the previous values rather than dropping back to "loading", since the
// own-id set is board-agnostic and only the recency map is slab-scoped.

import { useEffect, useState } from 'react'
import { ownUserProblemIds, readUserProblemsForSlab } from './userProblemsSync'
import { subscribeUserProblemsChanged } from './userProblemsStore'

export interface UserProblemFacets {
  /** The signed-in user's own `user:` ids. Empty when signed out. */
  ownProblemIds: Set<string>
  /** `updated_at` by `source_catalog_id` for this slab's authored rows. */
  recencyById: Map<string, string>
  /** The first read has resolved — until then the source facet is skipped. */
  ready: boolean
}

const EMPTY: UserProblemFacets = {
  ownProblemIds: new Set(),
  recencyById: new Map(),
  ready: false,
}

function facetsEqual(prev: UserProblemFacets, own: Set<string>, recency: Map<string, string>): boolean {
  if (!prev.ready) return false
  if (prev.ownProblemIds.size !== own.size || prev.recencyById.size !== recency.size) return false
  for (const id of own) if (!prev.ownProblemIds.has(id)) return false
  for (const [id, at] of recency) if (prev.recencyById.get(id) !== at) return false
  return true
}

export function useUserProblemFacets(layoutId: number, angle: number): UserProblemFacets {
  const [state, setState] = useState<UserProblemFacets>(EMPTY)

  useEffect(() => {
    let cancelled = false
    async function read() {
      // One pass over both reads: a partial result would let Community mislabel own rows.
      const [own, slab] = await Promise.all([
        ownUserProblemIds(),
        readUserProblemsForSlab(layoutId, angle),
      ])
      if (cancelled) return
      const recency = new Map(slab.map((p) => [p.sourceCatalogId, p.updatedAt]))
      // The change notification carries no payload, so unrelated mutations (another slab's
      // snapshot page, a different board's save) reach here too. Skip the state update when
      // nothing this hook derives actually changed — a fresh Set/Map identity would ripple
      // a new FilterContext through applyFilters over the whole list for nothing.
      setState((prev) => (facetsEqual(prev, own, recency) ? prev : { ownProblemIds: own, recencyById: recency, ready: true }))
    }
    // A failed read leaves `ready` where it was, so the facet keeps failing open rather than
    // filtering against a half-read cache.
    void read().catch(() => {})
    // Saves, edits, deletes and applied pull pages all reach a mounted list only through this
    // notification (the same signal useSlab re-reads on), so re-derive on each.
    const unsubscribe = subscribeUserProblemsChanged(() => void read().catch(() => {}))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [layoutId, angle])

  return state
}
