// Touch drag-to-reorder for the queue drawer's active list (U5). A hand-rolled gesture built on
// the `usePullToRefresh` idiom (KTD7): raw touchstart/touchmove/touchend listeners bound to the
// list element, with the live gesture math kept in closure vars (not React state) so `touchend`
// reads the current target index, not a stale render snapshot; state is only mirrored out to
// drive the lift + drop-indicator affordance.
//
// The crux: the list lives inside the drawer's vertical scroller and each row is also a tap
// target that opens problem detail. So a touch must be disambiguated three ways with one finger:
//   • a press that STARTS on a row's drag handle (`[data-queue-drag-handle]`) → reorder;
//   • a press anywhere else on the list → fall through to drawer scroll / row tap, untouched;
//   • a handle press with no movement past the slop → a tap: we never reorder, never swallow
//     the click, so tap-to-open stays reachable.
// Only the handle initiates a drag; the up/down move controls (U4) remain the pointer/keyboard/AT
// path for reorder (KTD7). The store owns the optimistic apply + rollback — this hook only emits
// the new id order via `onReorder`.

import { useEffect, useRef, useState, type RefObject } from 'react'

/** Finger travel (px) before a handle press counts as a drag rather than a tap. */
export const DRAG_SLOP = 6
/** Fallback row height (px) when a row can't be measured (e.g. jsdom); rows measure ~44px live. */
export const EST_ROW_HEIGHT = 44

/**
 * Target index for a drag of `dy` px from `startIndex`, one slot per row of travel and crossing
 * at the half-row threshold (via round), clamped to the list bounds. A no-op when `rowHeight` is
 * unknown (0), so an unmeasurable row never jumps.
 */
export function computeTargetIndex(
  startIndex: number,
  dy: number,
  rowHeight: number,
  count: number,
): number {
  if (rowHeight <= 0) return startIndex
  const steps = Math.round(dy / rowHeight)
  return Math.max(0, Math.min(count - 1, startIndex + steps))
}

/** Move the item at `from` to index `to`, returning a new array. Same-slot is the same reference.
 *  Out-of-range `from`/`to` return the input unchanged, so a stale index can never splice an
 *  `undefined` id into the order (defensive against a list that shrank mid-drag). */
export function reorderIds(ids: string[], from: number, to: number): string[] {
  if (from === to) return ids
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export interface DragReorderState {
  /** id of the row being dragged, or null when idle. */
  draggingId: string | null
  /** Live vertical translate of the dragged row (px). */
  offsetY: number
  /** Index where the dragged row will land on drop — drives the drop indicator. */
  targetIndex: number | null
}

export interface DragReorderOptions {
  /** Ordered active-item ids: the start-index source and the base for the emitted order. */
  ids: string[]
  /** Called with the new id order on a drop that changes the order (never on a same-slot drop). */
  onReorder: (orderedIds: string[]) => void
  /** Inert unless there is something to reorder (an active session with >1 active item). */
  enabled?: boolean
}

/**
 * Bind the drag-to-reorder gesture to the active-list element. Mirrors usePullToRefresh: listeners
 * attach in an effect keyed on `enabled`; the mutable options are read through a ref so a changing
 * id list never re-binds the listeners. Returns the drag state for the rows to render.
 */
export function useDragReorder(
  listRef: RefObject<HTMLElement | null>,
  opts: DragReorderOptions,
): DragReorderState {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [offsetY, setOffsetY] = useState(0)
  const [targetIndex, setTargetIndex] = useState<number | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!opts.enabled) return
    const list = listRef.current
    if (!list) return

    let itemId: string | null = null // id under the pressed handle, or null (not a drag)
    let startIndex = 0
    let startY = 0
    let rowHeight = EST_ROW_HEIGHT
    let engaged = false // passed the slop → we own the gesture (preventDefault, suppress click)
    let target = 0

    const reset = (): void => {
      itemId = null
      engaged = false
      setDraggingId(null)
      setOffsetY(0)
      setTargetIndex(null)
    }

    // A real drag must not also open the problem: swallow the click the browser synthesizes after
    // the touch sequence. A still tap never engages, so tap-to-open is untouched. The one-shot is
    // torn down shortly after in case no click follows. Mirrors useSwipeToQueue.
    const suppressNextClick = (): void => {
      const swallow = (ev: Event): void => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      list.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => list.removeEventListener('click', swallow, true), 400)
    }

    const onStart = (e: TouchEvent): void => {
      const handle = (e.target as Element | null)?.closest?.('[data-queue-drag-handle]') ?? null
      if (!handle) {
        itemId = null
        return // not a handle press — leave scroll / tap alone
      }
      const id = handle.getAttribute('data-item-id')
      const idx = id ? optsRef.current.ids.indexOf(id) : -1
      if (!id || idx < 0) {
        itemId = null
        return
      }
      itemId = id
      startIndex = idx
      target = idx
      startY = e.touches[0].clientY
      const row = handle.closest('li')
      rowHeight = row?.getBoundingClientRect().height || EST_ROW_HEIGHT
      engaged = false
    }

    const onMove = (e: TouchEvent): void => {
      if (itemId === null) return
      const dy = e.touches[0].clientY - startY
      if (!engaged) {
        if (Math.abs(dy) < DRAG_SLOP) return // still within the slop — could yet be a tap
        engaged = true
        setDraggingId(itemId)
      }
      e.preventDefault() // own the gesture: no drawer scroll while dragging
      target = computeTargetIndex(startIndex, dy, rowHeight, optsRef.current.ids.length)
      setOffsetY(dy)
      setTargetIndex(target)
    }

    const onEnd = (): void => {
      if (itemId === null) return
      const didEngage = engaged
      const movedId = itemId
      if (didEngage) suppressNextClick()
      reset()
      if (!didEngage) return
      // Resolve `from` against the LIVE id list, not the touchstart snapshot: the queue mutates over
      // the session's realtime channel, so a co-member's add/remove/reorder during the drag can have
      // shifted the list. Bail if the dragged row left the list mid-drag; clamp `to` to the current
      // length so a shrunk list can't index past the end.
      const liveIds = optsRef.current.ids
      const from = liveIds.indexOf(movedId)
      if (from < 0) return
      const to = Math.min(target, liveIds.length - 1)
      if (to !== from) optsRef.current.onReorder(reorderIds(liveIds, from, to))
    }

    list.addEventListener('touchstart', onStart, { passive: true })
    list.addEventListener('touchmove', onMove, { passive: false })
    list.addEventListener('touchend', onEnd, { passive: true })
    list.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      list.removeEventListener('touchstart', onStart)
      list.removeEventListener('touchmove', onMove)
      list.removeEventListener('touchend', onEnd)
      list.removeEventListener('touchcancel', onEnd)
      // If the effect re-runs mid-drag (e.g. a co-member removal drops the active count so `enabled`
      // flips false), no touchend will fire — clear any lingering drag state so the row isn't left
      // stuck visually lifted.
      setDraggingId(null)
      setOffsetY(0)
      setTargetIndex(null)
    }
  }, [opts.enabled, listRef])

  return { draggingId, offsetY, targetIndex }
}
