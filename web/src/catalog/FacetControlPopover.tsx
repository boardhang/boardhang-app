// The nav control for a PINNED rich facet (Grade, Holds, Sort, min-stars, Status, Methods).
// Renders a compact header button that reflects the facet's active value; tapping opens the
// facet's control. Grade/Sort/min-stars/Status/Methods open a shadcn Popover with the control
// plus an inline Clear (no ✕ micro-target in the nav row); Holds routes to the full-board
// HoldFilterPicker. An active facet's button gets the accent fill so "on" reads at a glance.
//
// Lists is handled by FilterPillBar directly (it opens ListFilterSheet and is board-gated), so
// it is not a case here. The control markup mirrors FilterControls so the two surfaces match.

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import { HoldFilterPicker } from './HoldFilterPicker'
import {
  METHOD_LABELS,
  SORT_LABELS,
  STATUS_KEYS,
  STATUS_LABELS,
  sortDimension,
  type FilterState,
  type SortKey,
  type StatusKey,
} from './filters'
import {
  facetActiveLabel,
  facetClearPatch,
  isFacetActive,
  type FacetContext,
  type PinnableFacetId,
} from './pinnableFacets'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SORT_KEYS: SortKey[] = ['easiest', 'hardest', 'rated', 'repeats']
const RATING_LABELS: Record<string, string> = {
  '0': 'Any rating',
  '1': '1★ and up',
  '2': '2★ and up',
  '3': '3★ and up',
  '4': '4★ and up',
  '5': '5★ and up',
}

interface FacetControlPopoverProps {
  facetId: Exclude<PinnableFacetId, 'benchmarks' | 'favorites' | 'lists'>
  filters: FilterState
  onChange: (next: FilterState) => void
  ctx: FacetContext
  /** The slab's grade span (ordinal [min, max]) for the Grade slider. */
  gradeSpan: [number, number]
  /** The active board — the HoldFilterPicker's geometry source. */
  board: CatalogBoardDef
}

/** Shared nav-trigger styling: the tinted accent "on" look when active (matching the pressed
 *  Benchmarks/Favorites toggles), a plain outline when not — never the loud solid primary. */
function triggerClass(active: boolean): string {
  return cn(
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
    active
      ? 'border border-accent bg-accent text-accent-foreground'
      : 'border border-input bg-transparent text-foreground hover:bg-muted hover:text-foreground',
  )
}

export function FacetControlPopover({
  facetId,
  filters,
  onChange,
  ctx,
  gradeSpan,
  board,
}: FacetControlPopoverProps) {
  const active = isFacetActive(facetId, filters, ctx)
  const label = facetActiveLabel(facetId, filters)
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  // Holds is not a popover — it opens the full-board picker, like the sheet's Holds row.
  const [holdPickerOpen, setHoldPickerOpen] = useState(false)
  if (facetId === 'holds') {
    return (
      <>
        <button
          type="button"
          onClick={() => setHoldPickerOpen(true)}
          aria-label="Filter by holds"
          className={triggerClass(active)}
        >
          {label}
        </button>
        <HoldFilterPicker
          board={board}
          open={holdPickerOpen}
          onOpenChange={setHoldPickerOpen}
          value={filters.holdsFilter}
          onChange={(holdsFilter) => set({ holdsFilter })}
        />
      </>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" aria-label={label} className={triggerClass(active)} />}
      >
        {label}
        <ChevronRight aria-hidden className="size-3 rotate-90 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <FacetBody facetId={facetId} filters={filters} set={set} gradeSpan={gradeSpan} />
        {active && facetId !== 'sort' && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => set(facetClearPatch(facetId))}
          >
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The per-facet control body inside the popover (mirrors the FilterControls rows). */
function FacetBody({
  facetId,
  filters,
  set,
  gradeSpan,
}: {
  facetId: PinnableFacetId
  filters: FilterState
  set: (patch: Partial<FilterState>) => void
  gradeSpan: [number, number]
}) {
  switch (facetId) {
    case 'grade':
      return <GradeBody filters={filters} set={set} gradeSpan={gradeSpan} />
    case 'sort':
      return <SortBody filters={filters} set={set} />
    case 'stars':
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Min rating</div>
          <Select
            items={RATING_LABELS}
            value={String(filters.minStars)}
            onValueChange={(v) => set({ minStars: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RATING_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'status':
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Ascent status</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_KEYS.map((k) => (
              <Toggle
                key={k}
                variant="outline"
                size="sm"
                pressed={filters.statusFilters.includes(k)}
                onPressedChange={(on) =>
                  set({
                    statusFilters: on
                      ? [...filters.statusFilters, k]
                      : filters.statusFilters.filter((x) => x !== k),
                  })
                }
              >
                {STATUS_LABELS[k as StatusKey]}
              </Toggle>
            ))}
          </div>
        </div>
      )
    case 'methods':
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Method</div>
          <div className="flex flex-wrap gap-1.5">
            {METHOD_LABELS.map((m) => (
              <Toggle
                key={m}
                variant="outline"
                size="sm"
                pressed={filters.methods.includes(m)}
                onPressedChange={(on) =>
                  set({
                    methods: on ? [...filters.methods, m] : filters.methods.filter((x) => x !== m),
                  })
                }
              >
                {m}
              </Toggle>
            ))}
          </div>
        </div>
      )
    default:
      return null
  }
}

/** Grade range slider — committed on release (not per drag tick) so the popover isn't
 *  re-rendered through the URL round-trip on every intermediate value. */
function GradeBody({
  filters,
  set,
  gradeSpan,
}: {
  filters: FilterState
  set: (patch: Partial<FilterState>) => void
  gradeSpan: [number, number]
}) {
  const range = filters.gradeRange ?? gradeSpan
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const value = drag ?? [range[0], range[1]]
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        {`Grade · ${FONT_GRADES[value[0]]} – ${FONT_GRADES[value[1]]}`}
      </div>
      <Slider
        aria-label="Grade range"
        min={gradeSpan[0]}
        max={gradeSpan[1]}
        step={1}
        value={value}
        onValueChange={(v) => setDrag([(v as number[])[0], (v as number[])[1]])}
        onValueCommitted={(v) => {
          const [lo, hi] = v as number[]
          set({ gradeRange: lo === gradeSpan[0] && hi === gradeSpan[1] ? null : [lo, hi] })
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
      />
    </div>
  )
}

/** Primary + secondary sort selects (the secondary must sit on a different dimension). */
function SortBody({
  filters,
  set,
}: {
  filters: FilterState
  set: (patch: Partial<FilterState>) => void
}) {
  const secondaryOptions = SORT_KEYS.filter(
    (k) => sortDimension(k) !== sortDimension(filters.sortPrimary),
  )
  // base-ui's Select resolves the trigger label from `items`; without it the trigger shows
  // the raw value. Mirror FilterControls' item maps.
  const secondaryItems: Record<string, string> = {
    none: 'No tiebreak',
    ...Object.fromEntries(secondaryOptions.map((k) => [k, SORT_LABELS[k]])),
  }
  const changePrimary = (primary: SortKey) => {
    const keep =
      filters.sortSecondary && sortDimension(filters.sortSecondary) !== sortDimension(primary)
    set({ sortPrimary: primary, sortSecondary: keep ? filters.sortSecondary : null })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Sort by</div>
        <Select
          items={SORT_LABELS}
          value={filters.sortPrimary}
          onValueChange={(v) => changePrimary(v as SortKey)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Then by</div>
        <Select
          items={secondaryItems}
          value={filters.sortSecondary ?? 'none'}
          onValueChange={(v) => set({ sortSecondary: v === 'none' ? null : (v as SortKey) })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No tiebreak</SelectItem>
            {secondaryOptions.map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
