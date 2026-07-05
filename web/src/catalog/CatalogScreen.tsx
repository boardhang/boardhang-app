// Wires the active board's slab into the browsing UI: the filter bar, the list,
// and the detail pager. Owns the single useSlab and derives the filter context
// (favorites + installed-hold-set climbable check) that applyFilters needs.

import { useCallback, useMemo, useState } from 'react'
import { FONT_GRADES, gradeIndex } from '../board/grades'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { activeSetIds, isClimbable, membershipFor } from '../board/holdSetMembership'
import { CatalogList } from './CatalogList'
import { FilterControls } from './FilterControls'
import { ProblemDetail } from './ProblemDetail'
import { applyFilters, type FilterContext } from './filters'
import { useFavorites } from './favoritesStore'
import { useFilters } from './useFilters'
import { useSlab } from './useSlab'
import type { CatalogProblem } from './catalogSync'

export function CatalogScreen() {
  const { activeBoard } = useBoardStore()
  const board = activeBoard
  // getAngle reads localStorage; the store re-renders this component on angle
  // change (useBoardStore), so reading it in render stays current.
  const angle = getAngle(board)

  const { problems, loading, degraded } = useSlab(board.layoutId, angle)
  const [filters, setFilters] = useFilters(board.layoutId, angle)
  const { favoriteIds } = useFavorites()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  // The slab's actual grade span (ordinal) for the slider, and its methods.
  const gradeSpan = useMemo<[number, number]>(() => {
    const idx = problems.map((p) => gradeIndex(p.grade)).filter((i) => i < FONT_GRADES.length)
    return idx.length ? [Math.min(...idx), Math.max(...idx)] : [0, FONT_GRADES.length - 1]
  }, [problems])
  const methods = useMemo(
    () => [...new Set(problems.map((p) => p.method).filter((m): m is string => !!m))].sort(),
    [problems],
  )

  // Installed-hold-set climbable check for the active board.
  const context = useMemo<FilterContext>(() => {
    const membership = membershipFor(board.membershipResource)
    const active = activeSetIds(getActiveHoldSetsRaw(board.layoutId), membership)
    return { favoriteIds, isClimbable: (holds) => isClimbable(membership, holds, active) }
  }, [board, favoriteIds])

  const transform = useCallback(
    (list: CatalogProblem[]) => applyFilters(list, filters, context),
    [filters, context],
  )
  const displayed = useMemo(() => transform(problems), [transform, problems])

  const openProblem = (problem: CatalogProblem) => {
    const i = displayed.findIndex((p) => p.source_catalog_id === problem.source_catalog_id)
    if (i >= 0) setOpenIndex(i)
  }

  if (openIndex !== null && displayed[openIndex]) {
    return (
      <ProblemDetail
        problems={displayed}
        index={openIndex}
        board={board}
        angle={angle}
        favoriteIds={favoriteIds}
        onIndexChange={setOpenIndex}
        onClose={() => setOpenIndex(null)}
      />
    )
  }

  return (
    <div>
      <FilterControls state={filters} onChange={setFilters} gradeSpan={gradeSpan} methods={methods} />
      <CatalogList
        board={board}
        angle={angle}
        problems={problems}
        loading={loading}
        degraded={degraded}
        favoriteIds={favoriteIds}
        transform={transform}
        onSelect={openProblem}
      />
    </div>
  )
}
