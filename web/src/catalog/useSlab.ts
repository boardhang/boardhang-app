// React binding for the catalog sync/cache layer. Reads the cached slab
// immediately for a fast first paint, then refreshes it via the best-effort
// delta sync. Surfaces loading and a `degraded` flag so the UI can show cached
// results with an offline banner (see the catalog list, U8).
//
// It is also where the two problem sources meet: opening a board (and pulling to refresh)
// syncs the imported catalog AND the slab's public custom problems, whose snapshot is what
// retracts a problem its author unpublished (KTD5).

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSlab, resyncSlab, syncSlab, type CatalogProblem } from './catalogSync'
import {
  loadUserProblems,
  subscribeUserProblemsChanged,
  syncPublicUserProblems,
} from './userProblemsStore'

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

  /**
   * Pull the slab's public custom problems (KTD5). Fired from the same two places the
   * imported catalog syncs — screen open and pull-to-refresh — and for signed-out visitors
   * too, since public rows are anon-readable.
   *
   * It never sets `problems`: the rows land in the user-problems database and reach this
   * hook through the change subscription below, which owns the merged re-read. All that
   * comes back here is the sync outcome, folded into `degraded` so a failed snapshot shows
   * up in the same offline banner an imported-catalog failure does — quietly, with whatever
   * is cached still on screen.
   */
  const pullPublicSnapshot = useCallback(async (): Promise<boolean> => {
    const { synced } = await syncPublicUserProblems(layoutId, angle).catch(() => ({
      synced: false,
    }))
    if (!synced && slabRef.current.layoutId === layoutId && slabRef.current.angle === angle) {
      setState((prev) => ({ ...prev, degraded: true }))
    }
    return synced
  }, [layoutId, angle])

  const resync = useCallback(async (): Promise<boolean> => {
    const { problems, synced } = await resyncSlab(layoutId, angle)
    if (slabRef.current.layoutId === layoutId && slabRef.current.angle === angle) {
      setState({ problems, loading: false, degraded: !synced })
    }
    // Always second, never in parallel: the snapshot's rows reach this state through the
    // change subscription below, so a setState from here racing one from there could drop
    // them. See the same ordering in load().
    const publicSynced = await pullPublicSnapshot()
    return synced && publicSynced
  }, [layoutId, angle, pullPublicSnapshot])

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

      // Last, so the imported rows paint without waiting on it and no setState from here
      // can lose a repaint the snapshot's own notification triggered.
      if (!cancelled) await pullPublicSnapshot()
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [layoutId, angle, pullPublicSnapshot])

  // Custom problems are merged into the slab from a second database that this hook never
  // syncs, so a save, edit or delete reaches an already-open list only through the store's
  // change notification (R7). Re-read rather than patch state: readSlab owns the merge and
  // the sort. The notification also fires per applied pull page, so this runs repeatedly
  // during a cold pull — each run is an idempotent read.
  useEffect(() => {
    let cancelled = false
    async function reread() {
      const problems = await readSlab(layoutId, angle).catch(() => null)
      if (cancelled || problems === null) return
      // Only `problems` — a re-read must not clear a `degraded` flag the sync set, nor
      // resolve `loading` before the first sync attempt has actually finished.
      setState((prev) => ({ ...prev, problems }))
    }
    const unsubscribe = subscribeUserProblemsChanged(() => void reread())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [layoutId, angle])

  // The store's post-sign-in pull is fire-and-forget, so a user whose first pull failed
  // (offline at sign-in, a transient 5xx) would otherwise not see their own problems until
  // the next sign-in. Opening a board retries it; a warm cache short-circuits without a
  // network call, and every applied page repaints through the subscription above.
  useEffect(() => {
    void loadUserProblems().catch(() => {
      // Best-effort: the merged slab still serves whatever is already cached.
    })
  }, [])

  return { ...state, resync }
}
