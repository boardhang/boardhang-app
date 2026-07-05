// The catalog list for one board+angle slab: a "Recently viewed" section, the
// problems (lazy-paginated), and the distinct empty/loading/offline states.
// Slab data (problems/loading/degraded) is supplied by the parent (CatalogScreen,
// which owns the single useSlab); sorting/filtering is layered on via the optional
// `transform` prop (defaults to the grade-ordinal sort).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogRow } from './CatalogRow'
import { RecentlyViewed } from './RecentlyViewed'
import { clearRecents, useRecents } from './recentsStore'
import { DEFAULT_FILTERS, applyFilters, type FilterContext } from './filters'
import type { CatalogProblem } from './catalogSync'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE = 30

// No-transform default: apply DEFAULT_FILTERS (all no-op filters + the default
// grade sort) so the unfiltered list matches exactly what U9's transform yields
// before any filter is set — the two "default sorts" can't drift.
const DEFAULT_CONTEXT: FilterContext = { favoriteIds: new Set(), isClimbable: () => true }

interface CatalogListProps {
  board: CatalogBoardDef
  angle: number
  problems: CatalogProblem[]
  loading: boolean
  degraded: boolean
  favoriteIds?: Set<string>
  showThumbnails?: boolean
  /** Filter/sort the slab's problems (U9). Defaults to grade-ordinal sort. */
  transform?: (problems: CatalogProblem[]) => CatalogProblem[]
  /** Hide "Recently viewed" while an active search query is narrowing the list. */
  hideRecents?: boolean
  onSelect?: (problem: CatalogProblem) => void
}

export function CatalogList({
  board,
  angle,
  problems,
  loading,
  degraded,
  favoriteIds = new Set(),
  showThumbnails = false,
  transform,
  hideRecents = false,
  onSelect,
}: CatalogListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)

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

  const recentIds = useRecents(board.layoutId, angle)
  const recentProblems = useMemo(() => {
    const byId = new Map(problems.map((p) => [p.source_catalog_id, p]))
    return recentIds
      .map((id) => byId.get(id))
      .filter((p): p is CatalogProblem => p !== undefined)
  }, [problems, recentIds])

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
    const message =
      problems.length > 0
        ? 'No problems match the current filters.'
        : degraded
          ? "You're offline and this board isn't cached yet."
          : 'No problems to show yet — sync this board to load its catalog.'
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="catalog-empty">
        {message}
        {problems.length > 0 && (
          <div className="mt-2 text-xs">Clear filters to see all problems.</div>
        )}
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
      {!hideRecents && (
        <RecentlyViewed
          problems={recentProblems}
          board={board}
          favoriteIds={favoriteIds}
          onSelect={onSelectProblem}
          onClear={() => clearRecents(board.layoutId, angle)}
        />
      )}
      <div className="px-3 py-1 text-xs text-muted-foreground">
        {displayed.length} problems
      </div>
      {visible.map((p) => (
        <CatalogRow
          key={p.source_catalog_id}
          problem={p}
          board={board}
          isFavorite={favoriteIds.has(p.source_catalog_id)}
          showThumbnail={showThumbnails}
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
