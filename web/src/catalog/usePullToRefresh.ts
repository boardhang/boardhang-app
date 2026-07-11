// Touch pull-to-refresh for the catalog list. Binds to the nearest `.app-scroll`
// ancestor of `anchorRef` (the shell's single scroll region — AppLayout) and engages
// ONLY when that scroller is pinned at the very top and the drag is downward, so it
// never fights normal scrolling or the frosted sticky header. `enabled=false` (e.g. the
// problem drawer is open) fully detaches the listeners. Gesture math lives in a local
// closure var (not React state) so `touchend` reads the live pull distance, not a stale
// render snapshot; state is only mirrored out for the indicator.

import { useEffect, useRef, useState, type RefObject } from 'react'

const THRESHOLD = 64 // px pull past which a release triggers the refresh
const MAX_PULL = 96 // visual cap on the pull (resistance takes over beyond this)
const RESISTANCE = 0.5 // finger-travel → indicator-travel ratio (rubber-band feel)

export interface PullState {
  /** Current indicator height in px (0 when idle). */
  distance: number
  /** True while the async refresh runs (indicator held, spinner spinning). */
  refreshing: boolean
  /** Pulled past the trigger threshold — flips the "release to sync" hint. */
  armed: boolean
  /** Finger is actively dragging (used to suppress the snap-back transition mid-drag). */
  pulling: boolean
}

export function usePullToRefresh(
  anchorRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
  enabled = true,
): PullState {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [pulling, setPulling] = useState(false)
  // Keep the latest onRefresh without re-binding listeners every render.
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh
  const busyRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const scroller = anchorRef.current?.closest('.app-scroll') as HTMLElement | null
    if (!scroller) return

    let startY: number | null = null
    let pull = 0 // live pull distance — read by onEnd, unlike the state snapshot

    const onStart = (e: TouchEvent): void => {
      if (busyRef.current || scroller.scrollTop > 0) {
        startY = null
        return
      }
      startY = e.touches[0].clientY
      pull = 0
    }
    const onMove = (e: TouchEvent): void => {
      if (startY === null || busyRef.current) return
      const dy = e.touches[0].clientY - startY
      // Upward drag, or the scroller has left the top: not a pull — release the gesture.
      if (dy <= 0 || scroller.scrollTop > 0) {
        if (pull !== 0) {
          pull = 0
          setPulling(false)
          setDistance(0)
        }
        if (scroller.scrollTop > 0) startY = null
        return
      }
      e.preventDefault() // own the gesture: no native overscroll/scroll while pulling
      pull = Math.min(MAX_PULL, dy * RESISTANCE)
      setPulling(true)
      setDistance(pull)
    }
    const onEnd = (): void => {
      if (startY === null) return
      const trigger = pull >= THRESHOLD
      startY = null
      setPulling(false)
      if (!trigger) {
        setDistance(0)
        return
      }
      busyRef.current = true
      setRefreshing(true)
      setDistance(THRESHOLD) // hold the indicator open while the refresh runs
      void Promise.resolve(refreshRef.current()).finally(() => {
        busyRef.current = false
        setRefreshing(false)
        setDistance(0)
      })
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd, { passive: true })
    scroller.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, anchorRef])

  return { distance, refreshing, armed: distance >= THRESHOLD, pulling }
}
