// The read-only detail pager: a full board render + metadata for one problem,
// prev/next across the current filtered list, favorite toggle, and Light up over
// Web Bluetooth. Records the view into recents. Mirrors iOS CatalogProblemPager.
//
// The shown problem is tracked by id (not a live array index), so if it leaves
// the filtered set while open (e.g. unfavorited under a favorites-only filter),
// the pager stays on it rather than jumping — prev/next just disable.

import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, ChevronLeft, ChevronRight, Heart, Lightbulb, Repeat, Star } from 'lucide-react'
import { bleClient, connectBoard, isConnected, setBleError, useBle } from '../ble/useBle'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getFlipped } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import type { CatalogHold, CatalogProblem } from './catalogSync'
import { recordRecent } from './recentsStore'
import { useFavorites } from './favoritesStore'
import type { HoldAssignment } from '../types'
import { Button } from '@/components/ui/button'

interface ProblemDetailProps {
  problems: CatalogProblem[]
  initialIndex: number
  board: CatalogBoardDef
  angle: number
  favoriteIds: Set<string>
  onClose: () => void
}

function toHoldAssignments(holds: CatalogHold[]): HoldAssignment[] {
  return holds.map((h) => ({ col: h.c, row: h.r, type: h.t }))
}

export function ProblemDetail({
  problems,
  initialIndex,
  board,
  angle,
  favoriteIds,
  onClose,
}: ProblemDetailProps) {
  const [current, setCurrent] = useState<CatalogProblem | undefined>(() => problems[initialIndex])
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const { state } = useBle()
  const { toggleFavorite } = useFavorites()
  const [lit, setLit] = useState(false)
  const [lightError, setLightError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'connecting' | 'sending' | null>(null)

  const currentId = current?.source_catalog_id

  // Record the view (move-to-front recents) whenever the shown problem changes.
  useEffect(() => {
    if (currentId) recordRecent(board.layoutId, angle, currentId)
  }, [currentId, board.layoutId, angle])

  // A newly-shown problem isn't lit yet; disconnecting clears the lit state.
  useEffect(() => setLit(false), [currentId])
  useEffect(() => {
    if (state !== 'connected') setLit(false)
  }, [state])

  // If there's nothing to show (the pager was opened on an empty list), close.
  useEffect(() => {
    if (!current) onClose()
  }, [current, onClose])

  if (!current) return null

  const pos = problems.findIndex((p) => p.source_catalog_id === current.source_catalog_id)
  const { visible } = holdSetContext(board.membershipResource, getActiveHoldSetsRaw(board.layoutId))
  const isFav = favoriteIds.has(current.source_catalog_id)

  async function lightUp() {
    if (busy) return
    setLightError(null)
    setBleError(null)
    if (!isConnected()) {
      setBusy('connecting')
      await connectBoard()
      if (!isConnected()) {
        setBusy(null)
        return // cancelled or failed
      }
    }
    setBusy('sending')
    try {
      await bleClient.send(toHoldAssignments(current!.holds), {
        rows: board.geometry.numRows,
        flipped: getFlipped(board.layoutId),
        showBeta: true,
      })
      setLit(true)
    } catch (err) {
      setLightError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const lightLabel = busy === 'connecting'
    ? 'Connecting…'
    : busy === 'sending'
      ? 'Sending…'
      : state === 'connected'
        ? lit
          ? 'Lit — send again'
          : 'Light up'
        : 'Connect & light up'

  const atFirst = pos <= 0
  const atLast = pos < 0 || pos >= problems.length - 1

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
    if (dx < 0 && !atLast) setCurrent(problems[pos + 1])
    else if (dx > 0 && !atFirst) setCurrent(problems[pos - 1])
  }

  return (
    <div className="space-y-4 pb-2">
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
          <Button
            variant="ghost"
            size="icon"
            aria-label={isFav ? 'Unfavorite' : 'Favorite'}
            aria-pressed={isFav}
            onClick={() => toggleFavorite(current.source_catalog_id)}
          >
            <Heart className={isFav ? 'size-5 fill-favorite text-favorite' : 'size-5'} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Previous problem" disabled={atFirst} onClick={() => setCurrent(problems[pos - 1])}>
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next problem" disabled={atLast} onClick={() => setCurrent(problems[pos + 1])}>
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      <div
        className="mx-auto w-full max-w-[17rem] touch-pan-y select-none"
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
      >
        <CatalogBoard board={board} holds={current.holds} visibleHoldSetIds={visible} showBeta />
      </div>

      <div className="space-y-1">
        <Button size="lg" className="w-full" onClick={lightUp} disabled={busy !== null}>
          <Lightbulb className={lit ? 'size-5 fill-current' : 'size-5'} />
          {lightLabel}
        </Button>
        {lightError && <p className="text-center text-sm text-destructive">{lightError}</p>}
      </div>
    </div>
  )
}
