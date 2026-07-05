// Pure filter + sort logic for the catalog, ported from iOS CatalogListView's
// computeDisplayed/filter + SortKey. Search, grade range, benchmark, min rating,
// method, favorites, and a drawn holds filter narrow the slab; the installed
// hold-set filter (climbable) is applied on top via context. Two-level sort keys
// off the canonical grade ordinal, never string compare.

import { FONT_GRADES, gradeIndex } from '../board/grades'
import type { CatalogProblem } from './catalogSync'

export type SortKey = 'easiest' | 'hardest' | 'rated' | 'repeats'

export const SORT_LABELS: Record<SortKey, string> = {
  easiest: 'Easiest first',
  hardest: 'Hardest first',
  rated: 'Highest rated',
  repeats: 'Most repeats',
}

/** The dimension a sort key orders on — the secondary key must differ from the primary. */
export function sortDimension(key: SortKey): 'grade' | 'stars' | 'repeats' {
  if (key === 'easiest' || key === 'hardest') return 'grade'
  if (key === 'rated') return 'stars'
  return 'repeats'
}

export interface FilterState {
  search: string
  sortPrimary: SortKey
  sortSecondary: SortKey | null
  /** Ordinal [min, max] over the canonical grade scale; null = full span. */
  gradeRange: [number, number] | null
  benchmarkOnly: boolean
  minStars: number
  /** Selected method labels; empty = any method. */
  methods: string[]
  favoritesOnly: boolean
  /** "col-row" positions a problem must include; empty = no holds filter. */
  holdsFilter: string[]
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  sortPrimary: 'easiest',
  sortSecondary: 'repeats',
  gradeRange: null,
  benchmarkOnly: false,
  minStars: 0,
  methods: [],
  favoritesOnly: false,
  holdsFilter: [],
}

/** Whether any filter (not sort/search) is narrowing the list — drives "Reset". */
export function hasActiveFilters(s: FilterState): boolean {
  return activeFilterCount(s) > 0
}

/** How many filter dimensions are active — drives the filter FAB's count badge. */
export function activeFilterCount(s: FilterState): number {
  return (
    (s.gradeRange ? 1 : 0) +
    (s.benchmarkOnly ? 1 : 0) +
    (s.minStars > 0 ? 1 : 0) +
    (s.methods.length > 0 ? 1 : 0) +
    (s.favoritesOnly ? 1 : 0) +
    (s.holdsFilter.length > 0 ? 1 : 0)
  )
}

/** Reset everything except sort (matches iOS "Reset filters"). */
export function resetFilters(s: FilterState): FilterState {
  return {
    ...DEFAULT_FILTERS,
    search: '',
    sortPrimary: s.sortPrimary,
    sortSecondary: s.sortSecondary,
  }
}

export interface FilterContext {
  favoriteIds: Set<string>
  /** Installed-hold-set filter (U5). Returns true when the problem is climbable. */
  isClimbable: (holds: CatalogProblem['holds']) => boolean
}

function compare(key: SortKey, a: CatalogProblem, b: CatalogProblem): number {
  switch (key) {
    case 'easiest':
      return gradeIndex(a.grade) - gradeIndex(b.grade)
    case 'hardest':
      return gradeIndex(b.grade) - gradeIndex(a.grade)
    case 'rated':
      return b.stars - a.stars
    case 'repeats':
      return b.repeats - a.repeats
  }
}

/** Filter then sort the slab's problems for display. */
export function applyFilters(
  problems: CatalogProblem[],
  s: FilterState,
  ctx: FilterContext,
): CatalogProblem[] {
  const q = s.search.trim().toLowerCase()
  const holdsNeeded = s.holdsFilter

  const filtered = problems.filter((p) => {
    if (q && !(p.name.toLowerCase().includes(q) || p.setter.toLowerCase().includes(q))) return false
    if (s.gradeRange) {
      const gi = gradeIndex(p.grade)
      // Unknown grades are never on the scale, so the range never hides them (AE4).
      if (gi < FONT_GRADES.length && (gi < s.gradeRange[0] || gi > s.gradeRange[1])) return false
    }
    if (s.benchmarkOnly && !p.is_benchmark) return false
    if (p.stars < s.minStars) return false
    if (s.methods.length > 0 && !(p.method && s.methods.includes(p.method))) return false
    if (s.favoritesOnly && !ctx.favoriteIds.has(p.source_catalog_id)) return false
    if (holdsNeeded.length > 0) {
      const own = new Set(p.holds.map((h) => `${h.c}-${h.r}`))
      if (!holdsNeeded.every((pos) => own.has(pos))) return false
    }
    return ctx.isClimbable(p.holds)
  })

  return filtered.sort((a, b) => {
    const primary = compare(s.sortPrimary, a, b)
    if (primary !== 0) return primary
    if (s.sortSecondary && sortDimension(s.sortSecondary) !== sortDimension(s.sortPrimary)) {
      const secondary = compare(s.sortSecondary, a, b)
      if (secondary !== 0) return secondary
    }
    return a.name.localeCompare(b.name)
  })
}
