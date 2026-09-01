import { useEffect, useRef } from 'react'

/**
 * Close a stacked sheet from the mobile back gesture: while `open`, push one history
 * entry keyed `stateKey`, close on popstate, and pop the entry again when the sheet
 * closes through its own UI — so "back" unwinds stacked sheets in order (player →
 * grid → problem drawer) without popping the ?problem= entry underneath.
 *
 * The latest `onClose` is read through a ref so the effect depends only on `open`:
 * an unstable parent callback would otherwise re-run the effect on every render,
 * firing history.back() and spuriously closing the sheet (React 18 StrictMode
 * reproduces it on mount).
 */
export function useHistoryBackClose(open: boolean, onClose: () => void, stateKey: string): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    // Merge, never replace: the current entry's state carries TanStack Router's own keys
    // (__TSR_index etc.), and a stacked sheet's entry must also keep the sheet key below it —
    // both so the router's back/forward index stays coherent and so a lower sheet's cleanup
    // still sees its own key when several sheets unwind in one commit.
    window.history.pushState({ ...window.history.state, [stateKey]: true }, '')
    // Only close when the popped-to entry no longer carries OUR key: with stacked
    // sheets (player over grid) every open sheet hears every popstate, and closing
    // unconditionally would collapse the whole stack on one back gesture.
    const onPop = (): void => {
      if (!window.history.state?.[stateKey]) closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closing via UI (not the back button): pop the entry we pushed so history stays clean.
      if (window.history.state?.[stateKey]) window.history.back()
    }
  }, [open, stateKey])
}
