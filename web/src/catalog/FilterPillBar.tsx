// The sticky header's filter-pill row (catalog only). One horizontally-scrolling line:
// the always-on Benchmark toggle pinned first (a pure toggle — no ✕, amber when on),
// then one removable pill per active filter (tap anywhere on the pill to remove; the ✕
// is a cue, not a separate hit target). Portaled into the frosted header by CatalogScreen
// (see headerFilterSlot); it renders inside CatalogScreen so it reads the same `filters`
// and writes through the same seed-writing `setFilters`.
//
// Pills come from the pure describeActiveFilters(); this component just renders them and
// applies each pill's `patch` on tap. Benchmark is NOT a pill from that list — it's the
// pinned toggle rendered here.

import { X } from 'lucide-react'
import { describeActiveFilters } from './activeFilterChips'
import { BENCHMARK_LABEL, FAVORITES_LABEL, type FilterState } from './filters'
import { Toggle } from '@/components/ui/toggle'

interface FilterPillBarProps {
  filters: FilterState
  onChange: (next: FilterState) => void
  /** A collab session targets this board → status is per-member; status pills suppressed. */
  inSession: boolean
  /** Signed in AND ascents loaded → status actually filters; gates status pills. */
  statusReady: boolean
}

export function FilterPillBar({ filters, onChange, inSession, statusReady }: FilterPillBarProps) {
  const chips = describeActiveFilters(filters, { inSession, statusReady })

  return (
    // -mx-4 + px-4: cancel the header's 1rem side padding so the scroll track spans the
    // full frosted column, while px-4 insets the first/last pill back onto the 1rem grid.
    // flex-nowrap + overflow-x-auto: one line that scrolls (never wraps) → predictable
    // single-row header height. Scrollbar hidden; horizontal pan for touch.
    <div
      // A labelled group, not a toolbar: every toggle/chip is its own native Tab stop, so
      // the widget has no roving-tabindex / arrow-key contract — `role="toolbar"` would
      // advertise navigation it doesn't implement.
      role="group"
      aria-label="Filters"
      className="-mx-4 flex touch-pan-x flex-nowrap items-center gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Toggle
        variant="outline"
        size="sm"
        pressed={filters.benchmarkOnly}
        onPressedChange={(v) => onChange({ ...filters, benchmarkOnly: v })}
        // Accessible name comes from the visible text (BENCHMARK_LABEL) — no aria-label,
        // matching FilterControls' toggles. On-state uses the Toggle's default accent fill
        // (same as the removable pills); just the smaller sizing here.
        className="h-6 shrink-0 px-2 text-xs"
      >
        {BENCHMARK_LABEL}
      </Toggle>

      <Toggle
        variant="outline"
        size="sm"
        pressed={filters.favoritesOnly}
        onPressedChange={(v) => onChange({ ...filters, favoritesOnly: v })}
        // Pinned always-on toggle like Benchmark (not a removable pill); accessible name
        // from the visible text, same neutral accent on-fill and smaller sizing.
        className="h-6 shrink-0 px-2 text-xs"
      >
        {FAVORITES_LABEL}
      </Toggle>

      {/* Divider between the pinned toggles (controls) and the removable active-filter
          tags. Only when there are tags — a trailing divider with nothing after reads as
          a mistake. */}
      {chips.length > 0 && <div aria-hidden className="h-4 w-px shrink-0 bg-border" />}

      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange({ ...filters, ...chip.patch })}
          aria-label={`Remove ${chip.label} filter`}
          // Outlined gray tag: the border defines the shape (a muted FILL would vanish
          // into the near-white frosted header in light mode, where --muted ≈
          // --background). Reads as secondary to the accent-FILLED pinned toggles, and
          // the trailing ✕ carries the "removable" signal. Works in both themes.
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span>{chip.label}</span>
          <X aria-hidden className="size-3 text-muted-foreground" />
        </button>
      ))}
    </div>
  )
}
