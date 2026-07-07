// The filter/sort controls shown inside the filter bottom sheet (search lives in
// the catalog top bar). Controlled: the parent owns FilterState and passes the
// slab's grade span + available methods. Built on shadcn Select/Slider/Toggle.
//
// The "Holds" row opens HoldFilterPicker — a full-board picker that writes the
// tapped positions into state.holdsFilter (applyFilters matches problems that
// use all selected holds).

import { useId, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import { HoldFilterPicker } from './HoldFilterPicker'
import { MemberStatusRow } from './MemberStatusRow'
import {
  SORT_LABELS,
  sortDimension,
  type FilterState,
  type SortKey,
  type StatusKey,
} from './filters'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
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

/** One member's row in the per-member "Ascent status" section (U5). */
export interface MemberFilterRow {
  userId: string
  /** Visible label — "You" for the self row, else the member's display label/initials. */
  label: string
  isSelf: boolean
  selected: StatusKey[]
  onToggle: (k: StatusKey, active: boolean) => void
}

/** Active-session status UI, threaded from CatalogScreen. When present the "Ascent status"
 *  section renders one row per member (self first) instead of the single self row. */
export interface SessionFilterUI {
  rows: MemberFilterRow[]
  /** 'loading' = projection unready (first load); 'ready' = live; 'paused' = projection
   *  errored or dropped by max-age, so cross-member filtering is off and the list is widened. */
  state: 'loading' | 'ready' | 'paused'
  /** Re-fetch the projection to reapply (wired to the session bar's refresh — U7). */
  onRefresh: () => void
}

interface FilterControlsProps {
  state: FilterState
  onChange: (state: FilterState) => void
  /** The active board — supplies geometry + hold-set membership for the picker. */
  board: CatalogBoardDef
  /** The slab's actual grade span as ordinal [min, max]. */
  gradeSpan: [number, number]
  /** Distinct method labels present in the slab. */
  methods: string[]
  /** Signed in AND ascents loaded — gates the status filter's count + Reset. */
  statusReady: boolean
  /** Definitively signed out — disables the status chips and shows the hint. */
  signedOut: boolean
  /** Active collaboration session (U5). When set, per-member status rows replace the single
   *  self row; when absent, the single-user status row is shown (unchanged behavior). */
  session?: SessionFilterUI
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

export function FilterControls({
  state,
  onChange,
  board,
  gradeSpan,
  methods,
  statusReady,
  signedOut,
  session,
}: FilterControlsProps) {
  const set = (patch: Partial<FilterState>) => onChange({ ...state, ...patch })
  const [holdPickerOpen, setHoldPickerOpen] = useState(false)
  const statusHintId = useId()
  const toggleStatus = (k: StatusKey, active: boolean) =>
    set({ statusFilters: active ? [...state.statusFilters, k] : state.statusFilters.filter((x) => x !== k) })
  const range = state.gradeRange ?? gradeSpan
  const secondaryOptions = SORT_KEYS.filter(
    (k) => sortDimension(k) !== sortDimension(state.sortPrimary),
  )
  const secondaryItems: Record<string, string> = {
    none: 'No tiebreak',
    ...Object.fromEntries(secondaryOptions.map((k) => [k, SORT_LABELS[k]])),
  }

  function changePrimary(primary: SortKey) {
    const keep = state.sortSecondary && sortDimension(state.sortSecondary) !== sortDimension(primary)
    set({ sortPrimary: primary, sortSecondary: keep ? state.sortSecondary : null })
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <Field label="Sort" className="flex-1">
          <Select items={SORT_LABELS} value={state.sortPrimary} onValueChange={(v) => changePrimary(v as SortKey)}>
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
        </Field>
        <Field label="Then by" className="flex-1">
          <Select
            items={secondaryItems}
            value={state.sortSecondary ?? 'none'}
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
        </Field>
      </div>

      <Field label={`Grade · ${FONT_GRADES[range[0]]} – ${FONT_GRADES[range[1]]}`}>
        <Slider
          aria-label="Grade range"
          min={gradeSpan[0]}
          max={gradeSpan[1]}
          step={1}
          value={[range[0], range[1]]}
          onValueChange={(value) => {
            const [lo, hi] = value as number[]
            set({ gradeRange: lo === gradeSpan[0] && hi === gradeSpan[1] ? null : [lo, hi] })
          }}
        />
      </Field>

      <Field label="Holds">
        <button
          type="button"
          onClick={() => setHoldPickerOpen(true)}
          className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm transition hover:bg-accent"
        >
          <span className={state.holdsFilter.length === 0 ? 'text-muted-foreground' : ''}>
            {state.holdsFilter.length === 0 ? 'Any' : `${state.holdsFilter.length} selected`}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Field>

      {/* Benchmarks + Favorites + the min-rating select share one flat row (iOS parity).
          Ascent status now lives in its own section below (per-member in a session). */}
      <Field label="Filter">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle variant="outline" size="sm" pressed={state.benchmarkOnly} onPressedChange={(v) => set({ benchmarkOnly: v })}>
            Benchmarks
          </Toggle>
          <Toggle variant="outline" size="sm" pressed={state.favoritesOnly} onPressedChange={(v) => set({ favoritesOnly: v })}>
            Favorites
          </Toggle>
          <Select items={RATING_LABELS} value={String(state.minStars)} onValueChange={(v) => set({ minStars: Number(v) })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RATING_LABELS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>

      {/* Ascent status: one self row when solo, one row per member (self first) in a session.
          Soft-caps at ~8 rows; the section scrolls within the sheet on mobile. */}
      <Field label="Ascent status">
        {session ? (
          <div className="space-y-2">
            {session.state === 'paused' && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                <span>Cross-member filtering paused — showing all problems.</span>
                <button
                  type="button"
                  onClick={session.onRefresh}
                  className="flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
                >
                  <RefreshCw className="size-3" />
                  Refresh
                </button>
              </div>
            )}
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {session.rows.map((row) => (
                <MemberStatusRow
                  key={row.userId}
                  label={row.label}
                  isSelf={row.isSelf}
                  ariaLabel={row.isSelf ? 'Your ascent status' : `${row.label}’s ascent status`}
                  selected={row.selected}
                  onToggle={row.onToggle}
                  rowState={session.state === 'loading' ? 'loading' : 'ready'}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            <MemberStatusRow
              ariaLabel="Your ascent status"
              selected={state.statusFilters}
              onToggle={toggleStatus}
              rowState={signedOut ? 'signed-out' : statusReady ? 'ready' : 'loading'}
              hintId={statusHintId}
            />
            {signedOut && (
              <div id={statusHintId} className="mt-1.5 text-xs text-muted-foreground">
                Sign in to filter by status
              </div>
            )}
          </>
        )}
      </Field>

      {methods.length > 0 && (
        <Field label="Method">
          <div className="flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <Toggle
                key={m}
                variant="outline"
                size="sm"
                pressed={state.methods.includes(m)}
                onPressedChange={(active) =>
                  set({ methods: active ? [...state.methods, m] : state.methods.filter((x) => x !== m) })
                }
              >
                {m}
              </Toggle>
            ))}
          </div>
        </Field>
      )}

      <HoldFilterPicker
        board={board}
        open={holdPickerOpen}
        onOpenChange={setHoldPickerOpen}
        value={state.holdsFilter}
        onChange={(holdsFilter) => set({ holdsFilter })}
      />
    </div>
  )
}
