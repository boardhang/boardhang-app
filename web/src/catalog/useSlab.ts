// React binding for the catalog sync/cache layer. Reads the cached slab
// immediately for a fast first paint, then refreshes it via the best-effort
// delta sync. Surfaces loading and a `degraded` flag so the UI can show cached
// results with an offline banner (see the catalog list, U8).

import { useEffect, useState } from 'react'
import { readSlab, syncSlab, type CatalogProblem } from './catalogSync'

export interface SlabState {
  /** The slab's problems (cached, then refreshed). */
  problems: CatalogProblem[]
  /** True until the first sync attempt for this slab resolves. */
  loading: boolean
  /** True when the slab is being served from cache because the sync couldn't
   *  reach the server (offline or a transient failure). */
  degraded: boolean
}

const INITIAL: SlabState = { problems: [], loading: true, degraded: false }

/**
 * Load and keep the given board+angle slab. Lazy per slab: changing `layoutId`
 * or `angle` reloads. Browsing works offline after a slab's first sync.
 */
export function useSlab(layoutId: number, angle: number): SlabState {
  const [state, setState] = useState<SlabState>(INITIAL)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, degraded: false }))

    async function load() {
      // Fast path: show whatever is cached before the network round-trip.
      try {
        const cached = await readSlab(layoutId, angle)
        if (!cancelled) setState({ problems: cached, loading: true, degraded: false })
      } catch {
        // A cache read failure is non-fatal; the sync below still runs.
      }

      // Refresh via best-effort delta sync. syncSlab returns the merged slab and
      // swallows transient failures, so treat "offline" as degraded; a throw
      // (defensive) falls back to the cached slab.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      try {
        const problems = await syncSlab(layoutId, angle)
        if (!cancelled) setState({ problems, loading: false, degraded: offline })
      } catch {
        const cached = await readSlab(layoutId, angle).catch(() => [] as CatalogProblem[])
        if (!cancelled) setState({ problems: cached, loading: false, degraded: true })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [layoutId, angle])

  return state
}
