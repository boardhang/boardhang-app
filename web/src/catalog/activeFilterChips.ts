// Pure derivation of the header filter-pill bar's *removable* pills from FilterState.
// The pinned toggles (Benchmark, Favorites) are NOT produced here — they are rendered
// separately by FilterPillBar (they toggle, they don't "remove"). Each descriptor carries
// the exact FilterState patch to apply on removal, so the component stays dumb: tap →
// onChange({ ...filters, ...patch }).
//
// Ordering and gating deliberately mirror activeFilterCount/applyFilters so a pill never
// appears for a filter the list isn't actually applying:
//   - status only when `statusReady` (signed in + ascents loaded) AND not in a session
//     (in a session applyFilters ignores `statusFilters`, using the per-member path).
//   - grade only for a real sub-range (`gradeRange` non-null; null = full span).

import { FONT_GRADES } from '../board/grades'
import { METHOD_LABELS, STATUS_KEYS, STATUS_LABELS, type FilterState } from './filters'

export interface FilterChip {
  /** Stable key so React never reshuffles pills on removal. */
  id: string
  label: string
  /** Applied over the current FilterState to remove this filter. */
  patch: Partial<FilterState>
}

export interface ChipContext {
  /** A collab session targets this board — status is filtered per-member, not via
   *  `statusFilters`, so status pills are suppressed. */
  inSession: boolean
  /** Signed in AND ascents loaded — gates the status dimension exactly like
   *  activeFilterCount. */
  statusReady: boolean
}

/**
 * Removable-pill descriptors for the given filter state, in fixed category order:
 * Grade → Min-stars → Methods → Status → Holds. (Benchmark and Favorites are the pinned
 * always-on toggles, produced by the component, not here; the saved-list selection is edited
 * via the "Lists" control, also not a removable chip.)
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

  // Favorites is a pinned always-on toggle in the bar (like Benchmark), not a removable
  // chip — so it is intentionally NOT emitted here. Saved-list selections likewise are NOT
  // chips: the "Lists" pill-bar control (pressed when active) is opened to edit them.

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

  // Status: only when it's actually filtering the list (see module note).
  if (ctx.statusReady && !ctx.inSession) {
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

  return chips
}
