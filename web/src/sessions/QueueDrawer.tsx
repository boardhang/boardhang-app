// The session playlist queue drawer + its entry point (U4). A bottom Drawer (the SessionPill
// idiom) opened from a "Queue" button whose badge shows the active-item count. Renders the active
// list (each row reorderable via up/down or the U5 drag handle, check-offable, removable) and a
// "Done" group below (un-checkable). The store (U2/queueStore) owns the optimistic writes and
// rolls back on failure; this component surfaces that rollback as a sonner error toast so the
// "writes fail loudly" promise (KTD5) is visible, announces check-offs/moves via an aria-live
// region, and — on a row tap — closes the drawer and opens the problem via the shared ?problem
// navigation (KTD9). Lighting stays the manual lightbulb; opening the queue never lights the board.
//
// Rendered only when a session is active on this board: SessionBar mounts it on the board catalog
// (a same-route ?problem update); SessionPill mounts it off-catalog (navigate to the board first).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogBoardDef } from '../board/boards'
import { getCatalogProblemsByIds, type CatalogProblem } from '../catalog/catalogSync'
import { useMemberSenders } from '../catalog/useMemberSenders'
import { addProblem, checkOff, removeItem, reorder, unCheck, useSessionQueue } from './queueStore'
import type { QueueItem } from './queueTypes'
import { useSessions } from './sessionsStore'
import { QueueItemRow } from './QueueItemRow'
import { useDragReorder } from './useDragReorder'
import { Badge } from '@/components/ui/badge'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Shown on any failed queue write — the store has already rolled the optimistic change back. */
const QUEUE_WRITE_ERROR = "Couldn't update the queue — check your connection"

export interface QueueDrawerProps {
  board: CatalogBoardDef
  /**
   * Close-then-open the problem via the shared ?problem navigation (KTD9). Surface-specific: a
   * same-route search update from SessionBar (already on the board catalog), or navigate-to-board-
   * then-open from SessionPill (off-catalog). QueueDrawer closes itself before calling this.
   */
  onOpenProblem: (sourceCatalogId: string) => void
  /** Styles the entry-point trigger to match the host chrome (catalog bar vs. pill panel). */
  triggerClassName?: string
}

export function QueueDrawer({ board, onOpenProblem, triggerClassName }: QueueDrawerProps) {
  const { activeSession } = useSessions()
  const sessionForBoard =
    activeSession && activeSession.boardLayoutId === board.layoutId ? activeSession : null
  const { status, activeItems, doneItems } = useSessionQueue(sessionForBoard?.id ?? null)
  const memberSenders = useMemberSenders(board)
  const senders = memberSenders?.senders

  const [open, setOpen] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const activeListRef = useRef<HTMLUListElement>(null)
  const [problemsById, setProblemsById] = useState<Map<string, CatalogProblem>>(new Map())

  // Resolve queued ids → catalog titles/grades (board-agnostic, offline IndexedDB lookup). Keyed
  // on the joined id list so it refetches only when the set of queued problems actually changes.
  const idsKey = useMemo(
    () => [...activeItems, ...doneItems].map((i) => i.sourceCatalogId).join(','),
    [activeItems, doneItems],
  )
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    if (ids.length === 0) {
      setProblemsById(new Map())
      return
    }
    let cancelled = false
    void getCatalogProblemsByIds(ids).then((m) => {
      if (!cancelled) setProblemsById(m)
    })
    return () => {
      cancelled = true
    }
  }, [idsKey])

  const nameOf = (id: string) => problemsById.get(id)?.name ?? 'this climb'

  // Touch drag-to-reorder (U5), bound to the active list. Only a press starting on a row's drag
  // handle engages; a drop into a new slot emits the new order (a same-slot drop is a no-op).
  // Declared before the `sessionForBoard` guard so the hook order is stable across renders.
  const drag = useDragReorder(activeListRef, {
    ids: activeItems.map((i) => i.id),
    enabled: activeItems.length > 1,
    onReorder: (nextIds) => {
      const movedId = drag.draggingId
      const moved = activeItems.find((i) => i.id === movedId)
      submitReorder(nextIds, nameOf(moved?.sourceCatalogId ?? ''), nextIds.indexOf(movedId ?? '') + 1)
    },
  })

  if (!sessionForBoard) return null

  const count = activeItems.length

  const openRow = (item: QueueItem) => {
    setOpen(false) // one drawer at a time (KTD9): close before the problem drawer opens
    onOpenProblem(item.sourceCatalogId)
  }

  const handleCheckOff = (item: QueueItem) => {
    const name = nameOf(item.sourceCatalogId)
    void checkOff(item.id)
      .then(() => setLiveMessage(`${name} checked off`))
      .catch(() => toast.error(QUEUE_WRITE_ERROR))
  }

  const handleUnCheck = (item: QueueItem) => {
    const name = nameOf(item.sourceCatalogId)
    void unCheck(item.id)
      .then((result) => {
        if (result === 'already-active') toast(`${name} is already in the queue`)
        else setLiveMessage(`${name} moved back to the queue`)
      })
      .catch(() => toast.error(QUEUE_WRITE_ERROR))
  }

  const handleRemove = (item: QueueItem) => {
    const name = nameOf(item.sourceCatalogId)
    void removeItem(item.id)
      .then(() => {
        // Undo re-adds via addProblem — the soft-delete has no restore-in-place API, so the item
        // returns at the END of the order (position resets); acceptable for v1.
        toast(`Removed ${name}`, {
          action: {
            label: 'Undo',
            onClick: () =>
              void addProblem(item.sourceCatalogId, item.boardLayoutId).catch(() =>
                toast.error(QUEUE_WRITE_ERROR),
              ),
          },
        })
      })
      .catch(() => toast.error(QUEUE_WRITE_ERROR))
  }

  // Shared reorder submit for both paths (up/down controls + U5 drag): optimistic RPC in the store,
  // rollback-to-server-order on failure surfaced as the same error toast as every other write.
  const submitReorder = (nextIds: string[], name: string, position: number) => {
    void reorder(nextIds)
      .then(() => setLiveMessage(`${name} moved to position ${position}`))
      .catch(() => toast.error(QUEUE_WRITE_ERROR))
  }

  const handleMove = (item: QueueItem, dir: -1 | 1) => {
    const ids = activeItems.map((i) => i.id)
    const idx = ids.indexOf(item.id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    submitReorder(next, nameOf(item.sourceCatalogId), target + 1)
  }

  const isEmpty = activeItems.length === 0 && doneItems.length === 0

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger
        aria-label={count > 0 ? `Queue, ${count} active` : 'Queue'}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-border bg-primary/10 px-2.5 py-1.5 text-sm font-medium text-foreground transition hover:bg-primary/15',
          triggerClassName,
        )}
      >
        <ListMusic className="size-4 shrink-0 text-primary" />
        <span>Queue</span>
        {count > 0 && (
          <Badge className="ml-0.5 min-w-5 justify-center px-1.5 tabular-nums">{count}</Badge>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Queue</DrawerTitle>
        </DrawerHeader>
        {/* Announces check-offs and position changes (including a co-member's refetched reorder). */}
        <div aria-live="polite" className="sr-only" data-testid="queue-live">
          {liveMessage}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 pt-1 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {status === 'loading' ? (
            <div className="space-y-2 py-2" data-testid="queue-loading">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : isEmpty ? (
            <p className="px-1 py-8 text-center text-sm text-balance text-muted-foreground">
              No climbs queued yet — add one from a problem, or swipe a catalog row left.
            </p>
          ) : (
            <>
              {activeItems.length > 0 && (
                <ul ref={activeListRef} className="mb-1">
                  {activeItems.map((item, i) => (
                    <QueueItemRow
                      key={item.id}
                      item={item}
                      problem={problemsById.get(item.sourceCatalogId)}
                      senders={senders?.get(item.sourceCatalogId)}
                      variant="active"
                      index={i}
                      total={activeItems.length}
                      onOpen={() => openRow(item)}
                      onCheckOff={() => handleCheckOff(item)}
                      onRemove={() => handleRemove(item)}
                      onMove={(dir) => handleMove(item, dir)}
                      isDragging={drag.draggingId === item.id}
                      dragOffsetY={drag.offsetY}
                      showDropIndicator={drag.draggingId !== null && drag.targetIndex === i && drag.draggingId !== item.id}
                    />
                  ))}
                </ul>
              )}
              {doneItems.length > 0 && (
                <section>
                  <h3 className="px-1 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Done
                  </h3>
                  <ul>
                    {doneItems.map((item) => (
                      <QueueItemRow
                        key={item.id}
                        item={item}
                        problem={problemsById.get(item.sourceCatalogId)}
                        senders={senders?.get(item.sourceCatalogId)}
                        variant="done"
                        onOpen={() => openRow(item)}
                        onUnCheck={() => handleUnCheck(item)}
                        onRemove={() => handleRemove(item)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
