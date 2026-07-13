// The catalog list for one board+angle slab: the problems (lazy-paginated) and the
// distinct empty/loading/offline states. Recently-viewed lives in the RecentsSheet
// FAB (CatalogScreen), not here. Slab data (problems/loading/degraded) is supplied
// by the parent (CatalogScreen, which owns the single useSlab); sorting/filtering
// is layered on via the optional `transform` prop (defaults to the grade-ordinal sort).

import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogRow } from './CatalogRow'
import { toggleShowPreviews, useShowPreviews } from './previewsStore'
import { DEFAULT_FILTERS, applyFilters, type FilterContext } from './filters'
import type { CatalogProblem } from './catalogSync'
import type { SenderChip } from './useMemberSenders'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const PAGE = 30

// No-transform default: apply DEFAULT_FILTERS (all no-op filters + the default
// grade sort) so the unfiltered list matches exactly what U9's transform yields
// before any filter is set — the two "default sorts" can't drift.
const DEFAULT_CONTEXT: FilterContext = {
  favoriteIds: new Set(),
  listMemberIds: new Set(),
  listMembersReady: false,
  isClimbable: () => true,
  sentIds: new Set(),
  loggedIds: new Set(),
  statusReady: false,
}

interface CatalogListProps {
  board: CatalogBoardDef
  angle: number
  problems: CatalogProblem[]
  loading: boolean
  degraded: boolean
  favoriteIds?: Set<string>
  /** Catalog ids the user has a logged send for — drives the green sent check. */
  sentIds?: Set<string>
  /** Per-problem "who sent it" chips for an active session (crew, self included) — the sends pill.
   *  Undefined = no session on this board; an empty/absent entry = nobody sent that problem. */
  senders?: Map<string, SenderChip[]>
  /** The session projection is paused/stale/offline — dim the last-known sender avatars. */
  sendersDimmed?: boolean
  /** Filter/sort the slab's problems (U9). Defaults to grade-ordinal sort. */
  transform?: (problems: CatalogProblem[]) => CatalogProblem[]
  /** A search query is narrowing the list — points the empty state at the search
      ✕ (not the filters, which search bypasses). */
  searchActive?: boolean
  /** "col-row" positions from the active holds filter to ring on thumbnails. */
  highlightHolds?: Set<string>
  onSelect?: (problem: CatalogProblem) => void
}

export function CatalogList({
  board,
  angle,
  problems,
  loading,
  degraded,
  favoriteIds = new Set(),
  sentIds = new Set(),
  senders,
  sendersDimmed = false,
  transform,
  searchActive = false,
  highlightHolds,
  onSelect,
}: CatalogListProps) {
  const showThumbnails = useShowPreviews()
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // A senders map is supplied only when a session targets this board (else undefined) — the rows
  // use this to move send status into the sends pill and suppress the name-line self-check.
  const sessionActive = senders !== undefined

  const displayed = useMemo(
    () => (transform ? transform(problems) : applyFilters(problems, DEFAULT_FILTERS, DEFAULT_CONTEXT)),
    [problems, transform],
  )

  // Reset pagination when the slab changes. Deliberately not keyed on `transform`:
  // an inline transform ref would reset the count every render and pin it at PAGE.
  useEffect(() => setVisibleCount(PAGE), [board.layoutId, angle])

  // Grow on scroll when the sentinel comes into view (button is the fallback).
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisibleCount((c) => c + PAGE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [displayed.length])

  const onSelectProblem = onSelect ?? (() => {})

  if (loading && problems.length === 0) {
    return (
      <div className="space-y-2 p-3" data-testid="catalog-loading">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (displayed.length === 0) {
    const message = searchActive
      ? 'No problems match your search.'
      : problems.length > 0
        ? 'No problems match the current filters.'
        : degraded
          ? "You're offline and this board isn't cached yet."
          : 'No problems to show yet — sync this board to load its catalog.'
    // Search bypasses FilterState, so point at the ✕ — "clear filters" wouldn't help.
    const hint = searchActive
      ? 'Clear the search (✕) to see all problems.'
      : problems.length > 0
        ? 'Clear filters to see all problems.'
        : null
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="catalog-empty">
        {message}
        {hint && <div className="mt-2 text-xs">{hint}</div>}
      </div>
    )
  }

  const visible = displayed.slice(0, visibleCount)

  return (
    <div>
      {degraded && (
        <div
          className="bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground"
          data-testid="catalog-offline"
        >
          Offline — showing cached problems
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-1 text-xs text-muted-foreground">
        <span>{displayed.length} problems</span>
        <button
          type="button"
          onClick={toggleShowPreviews}
          aria-pressed={showThumbnails}
          aria-label={showThumbnails ? 'Hide climb previews' : 'Show climb previews'}
          title={showThumbnails ? 'Hide climb previews' : 'Show climb previews'}
          className={cn(
            'flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
            showThumbnails ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <LayoutGrid className="size-4" />
        </button>
      </div>
      {visible.map((p) => (
        <CatalogRow
          key={p.source_catalog_id}
          problem={p}
          board={board}
          isFavorite={favoriteIds.has(p.source_catalog_id)}
          isSent={sentIds.has(p.source_catalog_id)}
          sessionActive={sessionActive}
          senders={senders?.get(p.source_catalog_id)}
          sendersDimmed={sendersDimmed}
          showThumbnail={showThumbnails}
          highlightHolds={highlightHolds}
          onSelect={onSelectProblem}
        />
      ))}
      {visible.length < displayed.length && (
        <div ref={sentinelRef} className="p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setVisibleCount((c) => c + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}
