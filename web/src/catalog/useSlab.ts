// React binding for the catalog sync/cache layer. Reads the cached slab
// immediately for a fast first paint, then refreshes it via the best-effort
// delta sync. Surfaces loading and a `degraded` flag so the UI can show cached
// results with an offline banner (see the catalog list, U8).

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSlab, resyncSlab, syncSlab, type CatalogProblem } from './catalogSync'

export interface SlabState {
  /** The slab's problems (cached, then refreshed). */
  problems: CatalogProblem[]
  /** True until the first sync attempt for this slab resolves. */
  loading: boolean
  /** True when the slab is being served from cache because the sync couldn't
   *  reach the server (offline or a transient failure). */
  degraded: boolean
  /** Force a full re-pull of this slab (pull-to-refresh). Resolves to whether the
   *  network pull succeeded, so the caller can toast success vs. offline. */
  resync: () => Promise<boolean>
}

const INITIAL: Omit<SlabState, 'resync'> = { problems: [], loading: true, degraded: false }

/**
 * Load and keep the given board+angle slab. Lazy per slab: changing `layoutId`
 * or `angle` reloads. Browsing works offline after a slab's first sync.
 */
export function useSlab(layoutId: number, angle: number): SlabState {
  const [state, setState] = useState<Omit<SlabState, 'resync'>>(INITIAL)
  // Guard resync results against a slab switch mid-refresh (same cancel discipline
  // as the load effect): a resync resolving after the user changed board/angle must
  // not overwrite the new slab's rows.
  const slabRef = useRef({ layoutId, angle })
  slabRef.current = { layoutId, angle }

  const resync = useCallback(async (): Promise<boolean> => {
    const { problems, synced } = await resyncSlab(layoutId, angle)
    if (slabRef.current.layoutId === layoutId && slabRef.current.angle === angle) {
      setState({ problems, loading: false, degraded: !synced })
    }
    return synced
  }, [layoutId, angle])

  useEffect(() => {
    let cancelled = false
    // Reset problems too, so a slab switch never briefly shows the previous
    // board's rows while the new slab loads.
    setState({ problems: [], loading: true, degraded: false })

    async function load() {
      // Fast path: show whatever is cached before the network round-trip.
      try {
        const cached = await readSlab(layoutId, angle)
        if (!cancelled) setState({ problems: cached, loading: true, degraded: false })
      } catch {
        // A cache read failure is non-fatal; the sync below still runs.
      }

      // Refresh via best-effort delta sync. syncSlab reports whether the network
      // pull actually succeeded; degraded reflects that real outcome (offline OR a
      // same-network 5xx/CORS/timeout), not a navigator.onLine guess. A throw here
      // means the final cache read failed — fall back defensively.
      try {
        const { problems, synced } = await syncSlab(layoutId, angle)
        if (!cancelled) setState({ problems, loading: false, degraded: !synced })
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

  return { ...state, resync }
}
