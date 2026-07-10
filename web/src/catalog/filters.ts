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

/** Ascent-status filter keys (iOS "My ascents" / "Not completed" / "Not logged"),
 *  web-native labels. sent wins over attempted when a problem has both. */
export type StatusKey = 'sent' | 'attempted' | 'unlogged'

export const STATUS_KEYS: readonly StatusKey[] = ['sent', 'attempted', 'unlogged']

export const STATUS_LABELS: Record<StatusKey, string> = {
  sent: 'Sent',
  attempted: 'Attempted',
  unlogged: 'Not logged',
}

/** UI labels for the boolean toggles — shared by the filter sheet toggles and the header
 *  pill so the two surfaces never drift. (Grade/method/status already share their sources;
 *  min-stars and holds are deliberately worded differently between the two surfaces.) */
export const BENCHMARK_LABEL = 'Benchmarks'
export const FAVORITES_LABEL = 'Favorites'

/**
 * The MoonBoard foot-rule "method" labels, as a FIXED list — the foot-rule subset of
 * iOS's CatalogListView.methodChoices (which additionally carries an "Any marked holds"
 * sentinel that is NOT a `method` value and so has no place here). A problem's `method`
 * is one of these or null. The filter shows all of them regardless of which appear in the
 * loaded slab, so the option is discoverable before any method-tagged problem loads.
 */
export const METHOD_LABELS: readonly string[] = ['No kickboard', 'Footless', 'Footless + kickboard']

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
  /** Selected ascent-status states (OR'd); empty = any status. */
  statusFilters: StatusKey[]
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  // Default sort: Most repeats, then Easiest first (popular problems first, ties
  // broken by grade). The two keys must stay on different sort dimensions.
  sortPrimary: 'repeats',
  sortSecondary: 'easiest',
  gradeRange: null,
  benchmarkOnly: false,
  minStars: 0,
  methods: [],
  favoritesOnly: false,
  holdsFilter: [],
  statusFilters: [],
}

/** Whether any filter (not sort/search) is narrowing the list — drives "Reset". */
export function hasActiveFilters(s: FilterState, statusReady = true): boolean {
  return activeFilterCount(s, statusReady) > 0
}

/**
 * How many filter dimensions are active — drives the filter FAB's count badge.
 * `statusReady` (signed in AND ascents loaded) gates the status dimension, so a
 * signed-out `?status=` link neither counts nor shows a Reset button.
 */
export function activeFilterCount(s: FilterState, statusReady = true): number {
  return (
    (s.gradeRange ? 1 : 0) +
    (s.benchmarkOnly ? 1 : 0) +
    (s.minStars > 0 ? 1 : 0) +
    (s.methods.length > 0 ? 1 : 0) +
    (s.favoritesOnly ? 1 : 0) +
    (s.holdsFilter.length > 0 ? 1 : 0) +
    (statusReady && s.statusFilters.length > 0 ? 1 : 0)
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

/** Per-member Set-pair (one member's sent/logged sets on this board). */
export interface MemberSetPair {
  sentIds: Set<string>
  loggedIds: Set<string>
}

/**
 * Collaboration-session status context (U4). When present it REPLACES the single-user
 * status clause: the self member row IS member row #1 (R5), so `statusFilters` is ignored
 * while a session is active. Semantics: OR within a member's row, AND across member rows,
 * an empty row = ignore. Gated on `ready` (U3's single atomic flag — roster known AND
 * projection fetched); until ready the whole clause is skipped so the list is never
 * silently wrong mid-load.
 */
export interface SessionStatusContext {
  /** Roster known AND projection fetched (U3). */
  ready: boolean
  /** The server-consistent membership snapshot (the set of member rows to intersect). */
  members: string[]
  /** Per-member chip selections (empty / absent row = that member does not participate). */
  memberStatus: Record<string, StatusKey[]>
  /** Per-member Set-pairs (roster-seeded — a zero-ascent member has empty Sets, not absent). */
  sets: Record<string, MemberSetPair>
}

export interface FilterContext {
  favoriteIds: Set<string>
  /** Installed-hold-set filter (U5). Returns true when the problem is climbable. */
  isClimbable: (holds: CatalogProblem['holds']) => boolean
  /** `source_catalog_id`s with ≥1 send on this board (attempts excluded). */
  sentIds: Set<string>
  /** `source_catalog_id`s with any ascent on this board (sent OR attempt). */
  loggedIds: Set<string>
  /** Signed in AND ascents loaded — gates the status predicate (and its count).
   *  False (signed-out, or the signed-in ascents-loading window) skips status
   *  entirely so a `?status=` deep-link never blanks the list before data lands. */
  statusReady: boolean
  /** Active collaboration session (U4). When set, per-member status filtering replaces the
   *  single-user `statusFilters` path; when absent, the single-user path runs unchanged. */
  session?: SessionStatusContext
}

const EMPTY_PAIR: MemberSetPair = { sentIds: new Set(), loggedIds: new Set() }

/** Whether a problem matches the OR of the selected status states. sent wins over
 *  attempted: a problem with any send is "sent", never "attempted". */
function matchesStatus(id: string, keys: StatusKey[], sentIds: Set<string>, loggedIds: Set<string>): boolean {
  return keys.some((k) =>
    k === 'sent'
      ? sentIds.has(id)
      : k === 'attempted'
        ? loggedIds.has(id) && !sentIds.has(id)
        : !loggedIds.has(id),
  )
}

/**
 * The per-member session status predicate (R4): AND across every member's row, where each
 * row is an OR over its selected states, and an empty (or absent) row is ignored. A member
 * is always present in `sets` when roster-seeded (U3), so a zero-ascent member reads as
 * unlogged-everywhere rather than being skipped. Self participates identically (R5).
 */
export function matchesSessionStatus(id: string, session: SessionStatusContext): boolean {
  return session.members.every((m) => {
    const keys = session.memberStatus[m] ?? []
    if (keys.length === 0) return true // empty row → this member does not constrain
    const pair = session.sets[m] ?? EMPTY_PAIR
    return matchesStatus(id, keys, pair.sentIds, pair.loggedIds)
  })
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
    // Status. With an active session the per-member clause replaces the single-user one
    // (self is member row #1 — R5); it is gated on the session's atomic readiness so the
    // list is never blanked mid-load. Without a session, the single-user path runs, itself
    // gated on statusReady so signed-out / still-loading never blanks a ?status= link.
    if (ctx.session) {
      if (ctx.session.ready && !matchesSessionStatus(p.source_catalog_id, ctx.session)) return false
    } else if (ctx.statusReady && s.statusFilters.length > 0) {
      if (!matchesStatus(p.source_catalog_id, s.statusFilters, ctx.sentIds, ctx.loggedIds)) return false
    }
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
