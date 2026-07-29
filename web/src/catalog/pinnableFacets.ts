// The catalog's pinnable filter facets — the single source of truth shared by the filter
// sheet (per-row pin icons) and the header nav (the unified pinned-control / chip render).
//
// A facet is either a `toggle` (a boolean flipped inline in the nav — Benchmarks, Favorites)
// or `rich` (opens a popover / picker in the nav — Grade, Holds, Sort, min-stars, Status,
// Methods). Lists is a rich opener but is only offered when the board actually has lists.
//
// CANONICAL_ORDER is the fixed left-to-right order pinned controls render in, so a pinned
// filter always sits in the same spot (muscle memory). It is intentionally NOT selection
// order.

import { FONT_GRADES } from '../board/grades'
import {
  BENCHMARK_LABEL,
  FAVORITES_LABEL,
  SORT_LABELS,
  STATUS_LABELS,
  type FilterState,
  type StatusKey,
} from './filters'

export type PinnableFacetId =
  | 'sort'
  | 'grade'
  | 'holds'
  | 'benchmarks'
  | 'favorites'
  | 'stars'
  | 'status'
  | 'methods'
  | 'lists'

export type FacetKind = 'toggle' | 'rich'

export interface PinnableFacet {
  id: PinnableFacetId
  /** Shown in the sheet row and (for rich facets, when inactive) as the nav control label. */
  label: string
  kind: FacetKind
}

/** Fixed left-to-right nav order for pinned controls. Benchmarks and Favorites lead (the two
 *  most-reached-for toggles), then the rich facets in a stable order. */
export const CANONICAL_ORDER: readonly PinnableFacet[] = [
  { id: 'benchmarks', label: BENCHMARK_LABEL, kind: 'toggle' },
  { id: 'favorites', label: FAVORITES_LABEL, kind: 'toggle' },
  { id: 'sort', label: 'Sort', kind: 'rich' },
  { id: 'grade', label: 'Grade', kind: 'rich' },
  { id: 'holds', label: 'Holds', kind: 'rich' },
  { id: 'stars', label: 'Min rating', kind: 'rich' },
  { id: 'status', label: 'Ascent status', kind: 'rich' },
  { id: 'methods', label: 'Method', kind: 'rich' },
  { id: 'lists', label: 'Lists', kind: 'rich' },
]

export const FACET_BY_ID: Record<PinnableFacetId, PinnableFacet> = Object.fromEntries(
  CANONICAL_ORDER.map((f) => [f.id, f]),
) as Record<PinnableFacetId, PinnableFacet>

/**
 * Per-member status as the header needs to describe it. Two facts, deliberately separate,
 * because a selection can exist without being applied:
 *
 * `members` is how many climbers you have picked statuses for — what the control is LABELLED
 * with, and what makes it worth showing at all. `applied` is whether applyFilters is actually
 * using them: it skips the whole per-member clause while the projection is unready
 * (`ctx.session.ready` in filters.ts) and widens the list to everything. That happens routinely,
 * not just on error — the projection carries a 5-minute max-age.
 *
 * Collapsing these two into one boolean is what produced the two bugs this facet has had: count
 * without `applied` and the header claims a filter the list isn't running; drop the count when
 * unapplied and a filter you set vanishes from the header with no trace. The header needs both,
 * so it can say "set, but paused".
 */
export interface SessionStatusFacet {
  /** Members with ≥1 status chip selected. */
  members: number
  /** Whether applyFilters is currently applying them (the projection is ready). */
  applied: boolean
}

/**
 * Gating context — mirrors describeActiveFilters/activeFilterCount so a facet reads "active"
 * only when it is actually narrowing the list.
 *
 * A UNION, not an interface with an optional field: in a session, per-member status is the only
 * thing that can answer the status facet, so `sessionStatus` must be present. As an optional
 * field a new caller could pass `inSession: true` and silently get "no status filter" — exactly
 * the bug this facet shipped with. The compiler now rejects that.
 */
export type FacetContext =
  | {
      /** No collab session targets this board — the single-user `statusFilters` path applies. */
      inSession: false
      /** Signed in AND ascents loaded — gates the status dimension. */
      statusReady: boolean
      sessionStatus?: undefined
    }
  | {
      /** A collab session targets this board — status is per-member; single-user status is off. */
      inSession: true
      statusReady: boolean
      sessionStatus: SessionStatusFacet
    }

/**
 * Whether a facet is currently narrowing the list. Sort is never "active" (it always has a
 * value but never filters); toggles/opener reflect their boolean/selection.
 */
export function isFacetActive(id: PinnableFacetId, s: FilterState, ctx: FacetContext): boolean {
  switch (id) {
    case 'sort':
      return false
    case 'grade':
      return s.gradeRange !== null
    case 'holds':
      return s.holdsFilter.length > 0
    case 'benchmarks':
      return s.benchmarkOnly
    case 'favorites':
      return s.favoritesOnly
    case 'stars':
      return s.minStars > 0
    case 'status':
      // In a session the single-user `statusFilters` clause is inert (applyFilters takes the
      // per-member path), so "active" means "members are selected AND the list is applying them".
      // A paused selection is not active — see facetPaused for the state it gets instead.
      if (ctx.inSession) return ctx.sessionStatus.members > 0 && ctx.sessionStatus.applied
      return ctx.statusReady && s.statusFilters.length > 0
    case 'methods':
      return s.methods.length > 0
    case 'lists':
      return s.listFilter.length > 0
  }
}

/** The label shown on a rich facet's nav control: the collapsed active value when the facet is
 *  filtering, otherwise the bare facet name (so an inactive pinned control reads "Holds", not
 *  "Holds (0)"). Sort always shows its current value — it's never "off".
 *
 *  `ctx` is only consulted for status: in a session the label counts MEMBERS with a selection
 *  ("Status (2)" = two climbers filtered), since `statusFilters` is not what's filtering there. */
export function facetActiveLabel(id: PinnableFacetId, s: FilterState, ctx?: FacetContext): string {
  switch (id) {
    case 'grade': {
      if (!s.gradeRange) return FACET_BY_ID.grade.label
      const [lo, hi] = s.gradeRange
      return lo === hi ? FONT_GRADES[lo] : `${FONT_GRADES[lo]}–${FONT_GRADES[hi]}`
    }
    case 'holds':
      return s.holdsFilter.length === 0 ? FACET_BY_ID.holds.label : `Holds (${s.holdsFilter.length})`
    case 'stars':
      return s.minStars === 0 ? FACET_BY_ID.stars.label : `≥${s.minStars}★`
    case 'methods':
      if (s.methods.length === 0) return FACET_BY_ID.methods.label
      return s.methods.length === 1 ? s.methods[0] : `Methods (${s.methods.length})`
    case 'status': {
      if (ctx?.inSession) {
        // Counts members REGARDLESS of `applied`: a paused selection still exists and still
        // reapplies on refresh, so the header keeps naming it — facetPaused carries the "not
        // running right now" part, which a bare count could never express.
        const { members } = ctx.sessionStatus
        return members === 0 ? FACET_BY_ID.status.label : `Status (${members})`
      }
      const keys = s.statusFilters
      if (keys.length === 0) return FACET_BY_ID.status.label
      return keys.length === 1 ? STATUS_LABELS[keys[0] as StatusKey] : `Status (${keys.length})`
    }
    case 'sort':
      return SORT_LABELS[s.sortPrimary]
    default:
      return FACET_BY_ID[id].label
  }
}

/**
 * The third state, between active and off: the user has picked statuses but the list is not
 * applying them, because the cross-member projection went stale (5-minute max-age) or its first
 * fetch failed. Only status can be paused — every other facet reads straight off FilterState,
 * which is always applied.
 *
 * The control still names the selection ("Status (2)") but renders dimmed rather than accented,
 * so the header tells the whole truth: this filter exists, and it is not running right now.
 * Dimming alone is not the message — callers must also put it in the accessible name.
 */
export function facetPaused(id: PinnableFacetId, ctx: FacetContext): boolean {
  if (id !== 'status' || !ctx.inSession) return false
  return isStatusPaused(ctx.sessionStatus)
}

/** The paused rule itself, over the two facts alone — so the chip (which holds a ChipContext, not
 *  a FacetContext) decides it the same way the pinned control does instead of re-deriving it. */
export function isStatusPaused(s: SessionStatusFacet): boolean {
  return s.members > 0 && !s.applied
}

/** The patch that clears a facet (used by rich facets' popover "Clear"). Sort has no cleared
 *  state, so it maps to no-op-ish empty patch and is never offered a Clear. Status IN A SESSION
 *  is the one facet this can't express — its state is per-member in the sessions store, so the
 *  control clears it via SessionFilterUI.onClearAll instead of this patch. */
export function facetClearPatch(id: PinnableFacetId): Partial<FilterState> {
  switch (id) {
    case 'grade':
      return { gradeRange: null }
    case 'holds':
      return { holdsFilter: [] }
    case 'stars':
      return { minStars: 0 }
    case 'status':
      return { statusFilters: [] }
    case 'methods':
      return { methods: [] }
    case 'lists':
      return { listFilter: [] }
    case 'benchmarks':
      return { benchmarkOnly: false }
    case 'favorites':
      return { favoritesOnly: false }
    case 'sort':
      return {}
  }
}

/** Map a removable chip's id (from describeActiveFilters) back to its facet, so the nav can
 *  suppress a chip whose facet is pinned (it renders as a pinned control instead). */
export function chipFacetId(chipId: string): PinnableFacetId {
  const head = chipId.split(':')[0]
  if (head === 'method') return 'methods'
  if (head === 'status') return 'status'
  return head as PinnableFacetId
}
