// The sticky header's filter-pill row (catalog only). One horizontally-scrolling line built
// from a SINGLE rule over the user's pinned facets and the remaining active filters:
//   - a PINNED facet always renders as its control (toggle inline / rich → popover or picker),
//     in fixed CANONICAL_ORDER, reflecting its active value — visible even when inactive;
//   - a facet that is NOT pinned but IS active renders as a removable chip (tap to remove);
//   - a facet that is neither is not shown.
// So a facet never appears twice. Which facets are pinned is user-configurable (per board
// layout) via the pin icons in the filter sheet; see pinnedFiltersStore / pinnableFacets.
//
// Portaled into the frosted header by CatalogScreen (see headerFilterSlot); it renders inside
// CatalogScreen so it reads the same `filters` and writes through the same seed-writing
// `setFilters`.

import { useState } from 'react'
import { ListFilter, X } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { describeActiveFilters } from './activeFilterChips'
import { FacetControlPopover } from './FacetControlPopover'
import { ListFilterSheet } from './ListFilterSheet'
import { BENCHMARK_LABEL, FAVORITES_LABEL, type FilterState } from './filters'
import { CANONICAL_ORDER, chipFacetId, type FacetContext } from './pinnableFacets'
import { usePinnedFacets } from './pinnedFiltersStore'
import type { SavedList } from '../lists/listsTypes'
import { Toggle } from '@/components/ui/toggle'

interface FilterPillBarProps {
  filters: FilterState
  onChange: (next: FilterState) => void
  /** A collab session targets this board → status is per-member; status controls suppressed. */
  inSession: boolean
  /** Signed in AND ascents loaded → status actually filters; gates status. */
  statusReady: boolean
  /** Definitively signed out → status can't filter, so a pinned status control is suppressed. */
  signedOut: boolean
  /** This board's live lists — drives the "Lists" control (hidden when empty, R4). */
  boardLists: SavedList[]
  /** Which board's pinned set to read/write. */
  layoutId: number
  /** The slab's grade span (ordinal [min, max]) for a pinned Grade control. */
  gradeSpan: [number, number]
  /** The active board — geometry source for a pinned Holds control. */
  board: CatalogBoardDef
}

export function FilterPillBar({
  filters,
  onChange,
  inSession,
  statusReady,
  signedOut,
  boardLists,
  layoutId,
  gradeSpan,
  board,
}: FilterPillBarProps) {
  const pinned = usePinnedFacets(layoutId)
  const ctx: FacetContext = { inSession, statusReady }
  const [listSheetOpen, setListSheetOpen] = useState(false)

  // Chips only for active facets that are NOT pinned (a pinned facet shows as its control).
  const chips = describeActiveFilters(filters, { inSession, statusReady }).filter(
    (chip) => !pinned.includes(chipFacetId(chip.id)),
  )

  // Does any pinned control actually render? (Lists is hidden with no lists; Status is hidden in
  // a session.) The divider only shows when there's a left group AND chips to divide from it.
  const hasPinnedControls = pinned.some((id) => {
    if (id === 'lists') return boardLists.length > 0
    if (id === 'status') return !inSession && !signedOut
    return true
  })

  return (
    // -mx-4 + px-4: cancel the header's 1rem side padding so the scroll track spans the
    // full frosted column, while px-4 insets the first/last item back onto the 1rem grid.
    // flex-nowrap + overflow-x-auto: one line that scrolls (never wraps) → predictable
    // single-row header height. Scrollbar hidden; horizontal pan for touch.
    <div
      // A labelled group, not a toolbar: every control/chip is its own native Tab stop, so
      // the widget has no roving-tabindex / arrow-key contract — `role="toolbar"` would
      // advertise navigation it doesn't implement.
      role="group"
      aria-label="Filters"
      className="-mx-4 flex touch-pan-x flex-nowrap items-center gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CANONICAL_ORDER.map((facet) => {
        if (!pinned.includes(facet.id)) return null
        switch (facet.id) {
          case 'benchmarks':
            return (
              <Toggle
                key={facet.id}
                variant="outline"
                size="sm"
                pressed={filters.benchmarkOnly}
                onPressedChange={(v) => onChange({ ...filters, benchmarkOnly: v })}
                className="h-6 shrink-0 px-2 text-xs"
              >
                {BENCHMARK_LABEL}
              </Toggle>
            )
          case 'favorites':
            return (
              <Toggle
                key={facet.id}
                variant="outline"
                size="sm"
                pressed={filters.favoritesOnly}
                onPressedChange={(v) => onChange({ ...filters, favoritesOnly: v })}
                className="h-6 shrink-0 px-2 text-xs"
              >
                {FAVORITES_LABEL}
              </Toggle>
            )
          case 'lists':
            // Rendered only when this board has ≥1 list (R4): with none to pick it'd be dead weight.
            if (boardLists.length === 0) return null
            return (
              <Toggle
                key={facet.id}
                variant="outline"
                size="sm"
                pressed={filters.listFilter.length > 0}
                onPressedChange={() => setListSheetOpen(true)}
                aria-label="Filter by list"
                className="h-6 shrink-0 gap-1 px-2 text-xs"
              >
                <ListFilter aria-hidden className="size-3.5" />
                Lists
              </Toggle>
            )
          case 'status':
            // In a collab session status is per-member (not single-user statusFilters), so a
            // single-user Status control would be misleading — suppress it, like its chip. Also
            // suppress when signed out (status can't filter, and it can't be pinned there).
            if (inSession || signedOut) return null
            return (
              <FacetControlPopover
                key={facet.id}
                facetId="status"
                filters={filters}
                onChange={onChange}
                ctx={ctx}
                gradeSpan={gradeSpan}
                board={board}
              />
            )
          default:
            return (
              <FacetControlPopover
                key={facet.id}
                facetId={facet.id}
                filters={filters}
                onChange={onChange}
                ctx={ctx}
                gradeSpan={gradeSpan}
                board={board}
              />
            )
        }
      })}

      {/* Divider between the pinned controls and the removable active-filter tags — only when
          BOTH sides are present, else a leading/trailing rule reads as a mistake. */}
      {hasPinnedControls && chips.length > 0 && (
        <div aria-hidden className="h-4 w-px shrink-0 bg-border" />
      )}

      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange({ ...filters, ...chip.patch })}
          aria-label={`Remove ${chip.label} filter`}
          // Outlined gray tag: the border defines the shape (a muted FILL would vanish into the
          // near-white frosted header in light mode). Reads as secondary to the accent-filled
          // pinned controls, and the trailing ✕ carries the "removable" signal. Both themes.
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span>{chip.label}</span>
          <X aria-hidden className="size-3 text-muted-foreground" />
        </button>
      ))}

      {boardLists.length > 0 && (
        <ListFilterSheet
          open={listSheetOpen}
          onOpenChange={setListSheetOpen}
          boardLists={boardLists}
          selected={filters.listFilter}
          onChange={(listFilter) => onChange({ ...filters, listFilter })}
        />
      )}
    </div>
  )
}
