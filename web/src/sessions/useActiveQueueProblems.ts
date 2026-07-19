// The active session queue, resolved to catalog problems in queue order — the data behind the
// problem-detail queue strip (which shows whenever the board's session queue is non-empty,
// regardless of how the detail was opened). Board-scoped and self-contained (the no-prop-drill
// idiom): reads the sessions + queue stores directly and returns [] when no session targets this
// board, so a caller can render the strip unconditionally on `.length > 0`. Mirrors the QueueDrawer
// id→problem resolution (offline IndexedDB lookup), keyed on the queued id list.

import { useEffect, useMemo, useState } from 'react'
import type { CatalogBoardDef } from '../board/boards'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useSessions } from './sessionsStore'
import { useSessionQueue } from './queueStore'

/** The active queue's problems for `board`, in queue order. Empty when no session targets it. */
export function useActiveQueueProblems(board: CatalogBoardDef): CatalogProblem[] {
  const { activeSession } = useSessions()
  const sessionForBoard =
    activeSession && activeSession.boardLayoutId === board.layoutId ? activeSession : null
  const { activeItems } = useSessionQueue(sessionForBoard?.id ?? null)

  const [byId, setById] = useState<Map<string, CatalogProblem>>(new Map())
  const idsKey = useMemo(
    () => activeItems.map((i) => i.sourceCatalogId).join(','),
    [activeItems],
  )
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    if (ids.length === 0) {
      setById(new Map())
      return
    }
    let cancelled = false
    void getCatalogProblemsByIds(ids).then((m) => {
      if (!cancelled) setById(m)
    })
    return () => {
      cancelled = true
    }
  }, [idsKey])

  // Resolve in queue order; ids whose lookup is still pending are skipped (they page in once ready).
  return useMemo(
    () =>
      activeItems
        .map((i) => byId.get(i.sourceCatalogId))
        .filter((p): p is CatalogProblem => Boolean(p)),
    [activeItems, byId],
  )
}
