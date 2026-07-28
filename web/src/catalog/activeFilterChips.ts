// Pure derivation of the header filter-pill bar's *removable* pills from FilterState.
// Every active facet is emitted here. FilterPillBar suppresses the chip for any facet the
// user has PINNED (it renders as a pinned control instead); an unpinned-but-active facet
// falls through to its removable chip. Each descriptor carries the exact FilterState patch to
// apply on removal, so the component stays dumb: tap → onChange({ ...filters, ...patch }).
//
// Ordering and gating deliberately mirror activeFilterCount/applyFilters so a pill never
// appears for a filter the list isn't actually applying:
//   - status is one chip per selected key when solo and `statusReady` (signed in + ascents
//     loaded). In a session applyFilters takes the per-member path instead, so the status slot
//     emits ONE collapsed "Status (n)" chip counting the MEMBERS filtered — supplied by the
//     caller via ctx.sessionStatus, since that state lives in the sessions store, not here.
//   - grade only for a real sub-range (`gradeRange` non-null; null = full span).

import { FONT_GRADES } from '../board/grades'
import {
  BENCHMARK_LABEL,
  FAVORITES_LABEL,
  METHOD_LABELS,
  SOURCE_LABELS,
  STATUS_KEYS,
  STATUS_LABELS,
  type FilterState,
} from './filters'

interface ChipBase {
  /** Stable key so React never reshuffles pills on removal. */
  id: string
  label: string
}

/**
 * A removable pill. Almost every facet lives in FilterState and so carries a `patch` the
 * component applies. The one exception is per-member session status, whose state lives in the
 * sessions store — it carries an `onRemove` callback instead. The union (rather than two
 * optional fields) keeps "exactly one removal mechanism" checked by the compiler.
 */
export type FilterChip =
  | (ChipBase & { patch: Partial<FilterState>; onRemove?: never })
  | (ChipBase & { patch?: never; onRemove: () => void })

export interface ChipContext {
  /** A collab session targets this board — status is filtered per-member, not via
   *  `statusFilters`. */
  inSession: boolean
  /** Signed in AND ascents loaded — gates the status dimension exactly like
   *  activeFilterCount. */
  statusReady: boolean
  /** In a session only: how many members have ≥1 status chip selected, and how to clear them
   *  all. Supplied by the caller (which reads the sessions store) so this module stays a pure
   *  function of FilterState. Omitted/zero → the status slot emits nothing. */
  sessionStatus?: { members: number; onClearAll: () => void }
}

/**
 * Removable-pill descriptors for the given filter state, in fixed category order:
 * Grade → Benchmarks → Favorites → Source → Min-stars → Methods → Status → Holds → Lists.
 */
export function describeActiveFilters(state: FilterState, ctx: ChipContext): FilterChip[] {
  const chips: FilterChip[] = []

  if (state.gradeRange) {
    const [lo, hi] = state.gradeRange
    chips.push({
      id: 'grade',
      label: `${FONT_GRADES[lo]}–${FONT_GRADES[hi]}`,
      patch: { gradeRange: null },
    })
  }

  // Benchmarks/Favorites/Lists were formerly pinned-only (never chips). Now that pinning is
  // user-configurable, an unpinned-but-active one must still be visible+removable in the bar,
  // so they are emitted here too; FilterPillBar suppresses the chip whenever the facet is
  // pinned (rendering it as the pinned control instead).
  if (state.benchmarkOnly) {
    chips.push({ id: 'benchmarks', label: BENCHMARK_LABEL, patch: { benchmarkOnly: false } })
  }

  if (state.favoritesOnly) {
    chips.push({ id: 'favorites', label: FAVORITES_LABEL, patch: { favoritesOnly: false } })
  }

  // Source: one chip carrying the selected value's own word ("Mine" / "Community"), since the
  // two are mutually exclusive and the value says more than the facet name would.
  if (state.source) {
    chips.push({ id: 'source', label: SOURCE_LABELS[state.source], patch: { source: null } })
  }

  if (state.minStars > 0) {
    chips.push({ id: 'stars', label: `≥${state.minStars}★`, patch: { minStars: 0 } })
  }

  // One pill per selected method, in the canonical option order (not selection order).
  for (const method of METHOD_LABELS) {
    if (state.methods.includes(method)) {
      chips.push({
        id: `method:${method}`,
        label: method,
        patch: { methods: state.methods.filter((m) => m !== method) },
      })
    }
  }

  // Status: only when it's actually filtering the list (see module note). In a session that
  // means the per-member rows, collapsed to one chip — the same "Status (n)" the pinned control
  // shows, so unpinning the facet doesn't change what the header reads.
  if (ctx.inSession) {
    const members = ctx.sessionStatus?.members ?? 0
    if (members > 0) {
      chips.push({
        id: 'status',
        label: `Status (${members})`,
        onRemove: ctx.sessionStatus!.onClearAll,
      })
    }
  } else if (ctx.statusReady) {
    for (const key of STATUS_KEYS) {
      if (state.statusFilters.includes(key)) {
        chips.push({
          id: `status:${key}`,
          label: STATUS_LABELS[key],
          patch: { statusFilters: state.statusFilters.filter((k) => k !== key) },
        })
      }
    }
  }

  // Holds have no per-value human label (they're board positions) → one collapsed pill.
  if (state.holdsFilter.length > 0) {
    chips.push({
      id: 'holds',
      label: `Holds (${state.holdsFilter.length})`,
      patch: { holdsFilter: [] },
    })
  }

  // Saved-list selection → one collapsed chip (the names live in the sheet/picker); removing
  // clears the whole list filter. Suppressed when Lists is pinned (shown as the control).
  if (state.listFilter.length > 0) {
    chips.push({
      id: 'lists',
      label: `Lists (${state.listFilter.length})`,
      patch: { listFilter: [] },
    })
  }

  return chips
}
