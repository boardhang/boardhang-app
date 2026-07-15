// Swipe-left-to-queue on a catalog row (U7). A hand-rolled touch gesture built on the
// `usePullToRefresh` idiom — raw touchstart/touchmove/touchend listeners bound to the row
// element, with the live gesture math kept in closure vars (not React state) so `touchend`
// reads the current delta, not a stale render snapshot; state is only mirrored out to drive
// the reveal affordance.
//
// The crux (KTD7 / R2 / F1): the row lives inside a vertical scroller that also carries
// pull-to-refresh, and the row itself is a tap target that opens problem detail. So the
// gesture must disambiguate FOUR interactions with the same finger:
//   • a dominant LEFT-horizontal swipe past the trigger → add to the queue (this hook);
//   • a vertical drag → fall through to scroll (never preventDefault, never engage);
//   • a downward pull at the top → let usePullToRefresh own it (same: fall through);
//   • a tap (no movement past the axis-lock) → open the problem (we never swallow the click).
// The disambiguation lives in `resolveSwipeAxis`: once movement passes the axis-lock we commit
// to whichever axis dominates (|dx| vs |dy|) and, if vertical, we bail for the rest of the
// gesture so scroll/pull-to-refresh are untouched. Only a horizontal-dominant, leftward gesture
// past the trigger fires the add. The hook is inert unless `enabled` (an active session on this
// board), so it never interferes when the crew isn't in a session.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { addProblem } from '../sessions/queueStore'

/** Finger travel (px) before we commit to an axis — below this a touch is still a tap. */
export const SWIPE_AXIS_LOCK = 10
/** Leftward travel (px) past which a release fires the queue-add. */
export const SWIPE_TRIGGER = 72
/** Visual cap on how far the row slides open (px). */
export const SWIPE_MAX_REVEAL = 96

export type SwipeAxis = 'none' | 'horizontal' | 'vertical'

/**
 * Commit a gesture to an axis once it passes the axis-lock. `'none'` while still within the
 * lock (a tap). Beyond it, the axis is whichever delta dominates — this is the single point
 * that keeps a vertical drag (scroll / pull-to-refresh) from being mistaken for a swipe.
 */
export function resolveSwipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.abs(dx) < SWIPE_AXIS_LOCK && Math.abs(dy) < SWIPE_AXIS_LOCK) return 'none'
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
}

/** A queue-add fires only for a horizontal-dominant, leftward gesture past the trigger. */
export function shouldQueueSwipe(dx: number, dy: number): boolean {
  return resolveSwipeAxis(dx, dy) === 'horizontal' && dx <= -SWIPE_TRIGGER
}

export interface SwipeToQueueState {
  /** Current horizontal offset in px (negative = revealed leftward, 0 idle). */
  offset: number
  /** Past the trigger threshold — a release now would fire the add. */
  armed: boolean
  /** An add is in flight — drives the brief confirm affordance. */
  confirming: boolean
}

export interface SwipeToQueueOptions {
  sourceCatalogId: string
  boardLayoutId: number
  /** Active only when there is an active session on this board. */
  enabled: boolean
}

/**
 * Bind the swipe-to-queue gesture to `rowRef`. Mirrors usePullToRefresh: listeners attach in an
 * effect keyed on `enabled`; the mutable options are read through a ref so a changing problem id
 * never re-binds the listeners. Returns the reveal state for the row to render.
 */
export function useSwipeToQueue(
  rowRef: RefObject<HTMLElement | null>,
  opts: SwipeToQueueOptions,
): SwipeToQueueState {
  const [offset, setOffset] = useState(0)
  const [armed, setArmed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const busyRef = useRef(false)

  useEffect(() => {
    if (!opts.enabled) return
    const el = rowRef.current
    if (!el) return

    let startX: number | null = null
    let startY = 0
    let axis: SwipeAxis = 'none'
    let dxNow = 0

    const clear = (): void => {
      startX = null
      axis = 'none'
      dxNow = 0
    }

    // A real horizontal drag must not also open the problem: swallow the click the browser
    // synthesizes after the touch sequence. A tap never locks horizontal, so tap-to-open is
    // untouched. The one-shot is torn down shortly after in case no click follows.
    const suppressNextClick = (): void => {
      const swallow = (ev: Event): void => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      el.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => el.removeEventListener('click', swallow, true), 400)
    }

    const fire = (): void => {
      if (busyRef.current) return
      busyRef.current = true
      setConfirming(true)
      const { sourceCatalogId, boardLayoutId } = optsRef.current
      void addProblem(sourceCatalogId, boardLayoutId)
        .then((result) => {
          toast(result === 'already-active' ? 'Already in the queue' : 'Added to the queue')
        })
        .catch(() => {
          toast.error('Couldn’t add to the queue — check your connection')
        })
        .finally(() => {
          busyRef.current = false
          setConfirming(false)
        })
    }

    const onStart = (e: TouchEvent): void => {
      if (busyRef.current) {
        startX = null
        return
      }
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      axis = 'none'
      dxNow = 0
    }

    const onMove = (e: TouchEvent): void => {
      if (startX === null || busyRef.current) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      dxNow = dx
      if (axis === 'none') {
        axis = resolveSwipeAxis(dx, dy)
        if (axis === 'none') return // still within the axis-lock — could yet be a tap
      }
      if (axis === 'vertical') return // fall through to scroll / pull-to-refresh, untouched
      // Horizontal: we own the gesture. Only a leftward drag reveals the action.
      e.preventDefault()
      const revealed = Math.max(-SWIPE_MAX_REVEAL, Math.min(0, dx))
      setOffset(revealed)
      setArmed(dx <= -SWIPE_TRIGGER)
    }

    const onEnd = (): void => {
      if (startX === null) {
        clear()
        return
      }
      const horizontal = axis === 'horizontal'
      const trigger = horizontal && dxNow <= -SWIPE_TRIGGER
      // Swallow the synthesized tap-open ONLY when the swipe actually fires the add. Axis commits at
      // just SWIPE_AXIS_LOCK (10px), so a near-tap with a little horizontal drift is "horizontal"
      // without ever reaching the trigger — suppressing its click would leave it neither queuing nor
      // opening (a dead gesture). A sub-trigger horizontal drift snaps back and still opens on tap.
      if (trigger) suppressNextClick()
      clear()
      setOffset(0)
      setArmed(false)
      if (trigger) fire()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [opts.enabled, rowRef])

  return { offset, armed, confirming }
}
