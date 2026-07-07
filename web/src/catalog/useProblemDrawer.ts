// The shared `?problem` detail-drawer protocol, used by both CatalogScreen and the
// logbook. The open problem's id lives in `?problem` (history-integrated, so browser Back
// closes the drawer); the *pager domain* is a state snapshot captured at open time —
// CatalogScreen hands over a recents snapshot, the logbook a day-session — because the id
// in `?problem` can't name which list the drawer was opened from.
//
// This hook owns the subtle, easy-to-drift parts: the push-on-open history entry, the
// close branch (pop history when we pushed, else clear the param in place), and dropping
// the snapshot whenever the drawer closes. The route-specific `?problem` writes stay with
// the caller (their `navigate` is route-typed), passed in as the three callbacks below;
// the caller also owns resolving `openId` + `pagerStack` into the current problem, since
// each screen resolves against a different domain.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { CatalogProblem } from './catalogSync'

interface UseProblemDrawerArgs {
  /** The open problem's id from `?problem` (`''` when the drawer is closed). */
  openId: string
  /** Push `?problem=<id>` (a new history entry, so Back closes the drawer). */
  pushProblem: (id: string) => void
  /** Replace `?problem=<id>` in place (paging between problems — no new history entry). */
  replaceProblem: (id: string) => void
  /** Replace `?problem` back to its `''` default in place (the strip middleware drops it). */
  clearProblem: () => void
}

interface UseProblemDrawerResult {
  /** The captured pager domain for the open drawer, or null (cold deep-link / closed). */
  pagerStack: CatalogProblem[] | null
  /** Open the drawer on `id`, capturing `stack` as its pager domain (null = no snapshot). */
  openProblem: (id: string, stack?: CatalogProblem[] | null) => void
  /** Page to another problem within the open drawer (replace, no history push). */
  showProblem: (id: string) => void
  /** Close the drawer: pop history if we push-opened it, else clear `?problem` in place. */
  closeDrawer: () => void
}

export function useProblemDrawer({
  openId,
  pushProblem,
  replaceProblem,
  clearProblem,
}: UseProblemDrawerArgs): UseProblemDrawerResult {
  const router = useRouter()
  const [pagerStack, setPagerStack] = useState<CatalogProblem[] | null>(null)

  // Drop the snapshot whenever the drawer closes (`?problem` cleared by any means: Back,
  // gesture, deep-link removal) so a later open never pages over a stale domain. Keyed on
  // `openId` only — not `pagerStack` — so it doesn't fire in the render between
  // `setPagerStack` and the router committing `?problem` on open.
  useEffect(() => {
    if (!openId) setPagerStack(null)
  }, [openId])

  // Whether this drawer session was push-opened (so Back should close it) rather than
  // entered cold via a deep link (nothing to go Back to).
  const pushed = useRef(false)

  const openProblem = (id: string, stack: CatalogProblem[] | null = null) => {
    pushed.current = true
    setPagerStack(stack)
    pushProblem(id)
  }
  const showProblem = (id: string) => replaceProblem(id)
  const closeDrawer = () => {
    if (pushed.current) {
      pushed.current = false
      void router.history.back()
    } else {
      clearProblem()
    }
  }

  return { pagerStack, openProblem, showProblem, closeDrawer }
}
