// The read-only detail pager: a full board render + metadata for one problem,
// prev/next across the current filtered list, favorite toggle, and Light up over
// Web Bluetooth. Records the view into recents. Mirrors iOS CatalogProblemPager.
//
// The shown problem is owned by the URL (?problem) and passed in as `problem`;
// paging calls `onNavigate(id)` (a replace-navigation) rather than mutating local
// state. The pager domain is the `displayed` list (the filtered catalog, or a
// recents snapshot when opened from the recents sheet) — a deep-linked problem the
// active filters exclude is not in it, so prev/next disable and it shows standalone.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, Heart, Lightbulb, ListPlus, Repeat, Star } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import { addAttemptTries } from '../logbook/ascents'
import { TryStepper } from '../logbook/TryStepper'
import { useLightUp } from '../ble/useLightUp'
import { CatalogBoard } from '../board/CatalogBoard'
// Px of the Beta section left peeking under the fold, so the "Beta videos" heading hints
// there's more below (and names it) without a separate affordance.
const BETA_PEEK = 34
import type { CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import type { CatalogProblem } from './catalogSync'
import { recordRecent } from './recentsStore'
import { recordOpened } from './lastOpenedStore'
import { useFavorites } from './favoritesStore'
import { LogAscentSheet, type LogTarget } from '../logbook/LogAscentSheet'
import { useAddToList } from '../lists/useAddToList'
import { BetaVideos } from '../beta/BetaVideos'
import { ProblemDetailAddToQueue } from './ProblemDetailAddToQueue'
import { ProblemDetailQueueStrip } from './ProblemDetailQueueStrip'
import { useActiveQueueProblems } from '../sessions/useActiveQueueProblems'
import { useShowPreviews } from './previewsStore'
import { Button } from '@/components/ui/button'

interface ProblemDetailProps {
  /** The problem to show (resolved from ?problem, with full-slab fallback, upstream). */
  problem: CatalogProblem
  /** The filtered paging domain — prev/next move within this list. */
  displayed: CatalogProblem[]
  board: CatalogBoardDef
  angle: number
  favoriteIds: Set<string>
  /** Catalog ids the user has a logged send for — drives the green sent check (iOS parity). */
  sentIds: Set<string>
  /** "col-row" positions from the active holds filter to ring on the board. */
  highlightHolds?: Set<string>
  /** Page to another problem (replace-navigates ?problem). */
  onNavigate: (id: string) => void
  /** Tap a queue-strip card: page to `id` AND hand prev/next off to the queue's order (`stack`).
   *  Only hosts with a swappable pager domain pass this (CatalogScreen); elsewhere a strip tap
   *  falls back to `onNavigate` (opens the climb without changing the paging list). */
  onPageOverQueue?: (id: string, stack: CatalogProblem[]) => void
}

export function ProblemDetail({
  problem: current,
  displayed,
  board,
  angle,
  favoriteIds,
  sentIds,
  highlightHolds,
  onNavigate,
  onPageOverQueue,
}: ProblemDetailProps) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const showThumbnails = useShowPreviews('catalog')
  // The board's active session queue (empty when no session targets this board) — the strip shows
  // whenever it's non-empty, regardless of how the detail was opened.
  const queueProblems = useActiveQueueProblems(board)
  const { toggleFavorite } = useFavorites()
  const { status } = useAuth()
  const signedIn = status !== 'signedOut'
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  // Inline "Log try" stepper state: session-local pending tries for the shown problem,
  // written (merged) to the unsent-attempt row only when leaving the problem (iOS parity).
  // The pending problem is held as the object so a leave-flush needs no list lookup.
  const [pendingProblem, setPendingProblem] = useState<CatalogProblem | null>(null)
  const [pendingTries, setPendingTries] = useState(0)

  const currentId = current.source_catalog_id

  // "Sheet hugs the problem": the drawer sizes to the details block so the Beta strip below
  // starts off-screen (scroll/drag up to reveal). We measure the details' natural height and
  // clamp the scroll container to it — capped at 85dvh, past which the details itself scrolls.
  // A ResizeObserver re-measures on layout changes (board art, viewport, paging).
  const detailsRef = useRef<HTMLDivElement>(null)
  const [detailsHeight, setDetailsHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = detailsRef.current
    if (!el) return
    const measure = () => setDetailsHeight(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [currentId])

  // Auth-gated save-to-list (owns its sheet + sign-in-resume — KTD3), shared with the bar.
  const addToList = useAddToList({ sourceCatalogId: currentId, board })
  // BLE "light up" for the shown problem (connect-then-send), shared with the bar.
  const light = useLightUp(board, currentId)

  // Record the view (move-to-front recents) whenever the shown problem changes; the
  // same seam seeds the last-opened bar (KTD2) so paging in the drawer keeps it current.
  useEffect(() => {
    recordRecent(board.layoutId, angle, currentId)
    recordOpened(board.layoutId, angle, currentId)
  }, [currentId, board.layoutId, angle])

  // ── Deferred flush of the inline "Log try" stepper (iOS parity) ──────────────
  // Write/merge the unsent-attempt row only when the user leaves the problem: paging
  // to another problem, or closing the pager (unmount). Same-day tries accumulate.
  const flush = useCallback((p: CatalogProblem | null, tries: number) => {
    if (!p || tries <= 0) return
    void addAttemptTries({
      sourceCatalogId: p.source_catalog_id,
      problemName: p.name,
      problemGrade: p.grade,
      boardLayoutId: board.layoutId,
      date: new Date().toISOString(),
      addTries: tries,
    })
  }, [board.layoutId])

  // Mirror pending state into refs so the navigation/unmount flushes read fresh values
  // without re-subscribing.
  const pendingRef = useRef<{ problem: CatalogProblem | null; tries: number }>({
    problem: null,
    tries: 0,
  })
  useEffect(() => {
    pendingRef.current = { problem: pendingProblem, tries: pendingTries }
  }, [pendingProblem, pendingTries])
  const flushRef = useRef(flush)
  flushRef.current = flush

  // Flush the previous problem's pending tries when the shown problem changes (paging).
  const shownIdRef = useRef(currentId)
  useEffect(() => {
    if (shownIdRef.current !== currentId) {
      const prev = pendingRef.current
      if (prev.problem && prev.problem.source_catalog_id !== currentId) {
        flush(prev.problem, prev.tries)
        setPendingProblem(null)
        setPendingTries(0)
      }
      shownIdRef.current = currentId
    }
  }, [currentId, flush])

  // Flush on close/unmount (drawer dismissed → ProblemDetail unmounts).
  useEffect(
    () => () => {
      const { problem, tries } = pendingRef.current
      flushRef.current(problem, tries)
    },
    [],
  )

  const pos = displayed.findIndex((p) => p.source_catalog_id === currentId)
  const { visible } = holdSetContext(board.membershipResource, getActiveHoldSetsRaw(board.layoutId))
  const isFav = favoriteIds.has(currentId)
  const isSent = sentIds.has(currentId)

  const lightLabel = light.busy === 'connecting'
    ? 'Connecting…'
    : light.busy === 'sending'
      ? 'Sending…'
      : light.state === 'connected'
        ? light.lit
          ? 'Lit — send again'
          : 'Light up'
        : 'Connect & light up'

  const atFirst = pos <= 0
  const atLast = pos < 0 || pos >= displayed.length - 1

  // The count shown in the stepper — session-local pending tries for THIS problem only
  // (starts at 0 each time a problem is shown; not hydrated from existing logs, per iOS).
  const currentTries = pendingProblem?.source_catalog_id === currentId ? pendingTries : 0

  function addTry() {
    if (!signedIn) {
      setSignInOpen(true)
      return
    }
    if (pendingProblem?.source_catalog_id !== currentId) {
      setPendingProblem(current)
      setPendingTries(1)
    } else {
      setPendingTries((t) => t + 1)
    }
  }

  function removeTry() {
    if (currentTries <= 0) return
    setPendingTries((t) => {
      const next = t - 1
      if (next === 0) setPendingProblem(null)
      return next
    })
  }

  // "Log ascent" opens the full sheet as a SEND, pre-seeding tries from the stepper.
  function logAscent() {
    if (!signedIn) {
      setSignInOpen(true)
      return
    }
    setLogTarget({
      kind: 'create',
      sourceCatalogId: currentId,
      problemName: current.name,
      problemGrade: current.grade,
      boardLayoutId: board.layoutId,
      sent: true,
      tries: Math.max(currentTries, 1),
    })
    setLogOpen(true)
  }

  // Side-swipe the board to page prev/next (vertical drags fall through to the
  // drawer's swipe-to-dismiss).
  function onSwipeStart(e: React.PointerEvent) {
    swipeStart.current = { x: e.clientX, y: e.clientY }
  }
  function onSwipeEnd(e: React.PointerEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return // not a clear horizontal swipe
    if (dx < 0 && !atLast) onNavigate(displayed[pos + 1].source_catalog_id)
    else if (dx > 0 && !atFirst) onNavigate(displayed[pos - 1].source_catalog_id)
  }

  return (
    // Scroll container clamped to the measured details height (≤85dvh) so the sheet hugs the
    // problem and Beta is below the fold; snap-proximity settles a scroll onto either page.
    <div
      className="snap-y snap-proximity overflow-y-auto overscroll-contain px-4"
      style={{ maxHeight: '85dvh', height: detailsHeight ? detailsHeight + BETA_PEEK : undefined }}
    >
      <div ref={detailsRef} className="flex snap-start flex-col gap-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <h1 className="min-w-0 break-words text-sm font-bold uppercase leading-tight tracking-tight">
              {current.name}
            </h1>
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
              {current.grade}
            </span>
            {current.is_benchmark && (
              <BadgeCheck className="size-3.5 shrink-0 text-benchmark" aria-label="Benchmark" />
            )}
            {isSent && (
              <CheckCircle2 role="img" aria-label="Sent" className="size-3.5 shrink-0 text-success" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="break-words">
              {current.setter ? `by ${current.setter}` : `${current.holds.length} holds`}
            </span>
            {current.stars > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5" /> {current.stars}
              </span>
            )}
            {current.repeats > 0 && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="size-3.5" /> {current.repeats}
              </span>
            )}
            {current.method && <span className="text-foreground/70">{current.method}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ProblemDetailAddToQueue sourceCatalogId={currentId} boardLayoutId={board.layoutId} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Save to list"
            onClick={addToList.saveToList}
          >
            <ListPlus className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isFav ? 'Unfavorite' : 'Favorite'}
            aria-pressed={isFav}
            onClick={() => toggleFavorite(currentId)}
          >
            <Heart className={isFav ? 'size-5 fill-favorite text-favorite' : 'size-5'} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Previous problem" disabled={atFirst} onClick={() => onNavigate(displayed[pos - 1].source_catalog_id)}>
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next problem" disabled={atLast} onClick={() => onNavigate(displayed[pos + 1].source_catalog_id)}>
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      <div
        className="mx-auto w-full max-w-[17rem] touch-pan-y select-none"
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
      >
        <CatalogBoard board={board} holds={current.holds} visibleHoldSetIds={visible} showBeta highlightHolds={highlightHolds} />
      </div>

      <Button
        size="lg"
        variant="secondary"
        className="w-full"
        onClick={() => void light.lightUp(current.holds)}
        disabled={light.busy !== null}
      >
        <Lightbulb className={light.lit ? 'size-5 fill-current' : 'size-5'} />
        {lightLabel}
      </Button>

      <div className="flex items-center gap-3">
        <TryStepper count={currentTries} onRemove={removeTry} onAdd={addTry} />
        <Button size="lg" className="flex-1" onClick={logAscent}>
          <CheckCircle2 className="size-5" />
          Log ascent
        </Button>
      </div>
      </div>

      {/* Below the fold — its own snap target, revealed by scrolling/dragging up. Whenever the
          board's session queue is non-empty, the queue strip leads this page (above beta) so
          scrolling up surfaces "up next". Tapping a card hands prev/next off to the queue's order
          (onPageOverQueue) where the host supports it, else just opens the climb. */}
      <div className="snap-start space-y-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">
        {queueProblems.length > 0 && (
          <ProblemDetailQueueStrip
            items={queueProblems}
            currentId={currentId}
            board={board}
            showThumbnail={showThumbnails}
            onSelect={(id) =>
              onPageOverQueue ? onPageOverQueue(id, queueProblems) : onNavigate(id)
            }
          />
        )}
        <BetaVideos sourceCatalogId={currentId} />
      </div>

      <LogAscentSheet
        open={logOpen}
        onOpenChange={setLogOpen}
        target={logTarget}
        onSaved={() => {
          // The send consumed the pending tries — clear them so they aren't ALSO
          // flushed as a separate unsent-attempt row.
          setPendingProblem(null)
          setPendingTries(0)
        }}
      />
      <SignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        title="Sign in to log ascents"
      />
      {addToList.element}
    </div>
  )
}
