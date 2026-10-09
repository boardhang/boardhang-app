// Multi-select sheet for the catalog's setter filter. Lists every setter on the current slab
// with a FACETED count — how many of their problems pass every other active filter — and a
// search box that narrows the list by name. Each tap toggles that setter in `setterFilter`
// LIVE (no Apply step), so the catalog updates behind the open sheet, exactly like
// ListFilterSheet. The rows come from CatalogScreen (`setterOptions` in filters.ts) through a
// lazy thunk, so the slab pass runs only while this sheet is open.
//
// Row layout (chosen from four prototypes, 2026-10-09): the name with the count spelled out as a
// caption underneath ("227 problems"), so the number explains itself without a description line
// at the top. The list is CAPPED at the top SETTER_LIST_CAP by count until you type (see
// visibleSetters.ts for the cap, the query match and the selected-first ordering); a footer says
// how many more the search box reaches.

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { SetterOption } from './filters'
import { problemCountLabel, visibleSetters } from './visibleSetters'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SetterFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The slab's setters with faceted counts — a thunk, called only while the sheet is open. */
  getOptions: () => SetterOption[]
  /** Currently-selected setter names (`setterKey`s). */
  selected: string[]
  /** Apply a new selection (writes through to the URL/seed via CatalogScreen). */
  onChange: (names: string[]) => void
}

export function SetterFilterSheet({ open, onOpenChange, getOptions, selected, onChange }: SetterFilterSheetProps) {
  const [query, setQuery] = useState('')
  const selectedSet = new Set(selected)
  // Compute nothing while closed: the Drawer renders no content, and the thunk is the whole
  // point of keeping the slab pass off the hot path.
  const { rows, hidden } = open ? visibleSetters(getOptions(), selected, query) : { rows: [], hidden: 0 }

  const toggle = (name: string) => {
    // Live: recompute the set and hand it back immediately (no batched Apply).
    onChange(selectedSet.has(name) ? selected.filter((n) => n !== name) : [...selected, name])
  }

  const close = (next: boolean) => {
    // A query is a transient aid to one visit — never carry it into the next open.
    if (!next) setQuery('')
    onOpenChange(next)
  }

  return (
    <Drawer open={open} onOpenChange={close} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <div className="flex flex-row items-center justify-between gap-2">
            <DrawerTitle>Filter by setter</DrawerTitle>
            {selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                Clear all
              </Button>
            )}
          </div>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search setters"
            aria-label="Search setters"
            autoComplete="off"
            className="mt-2"
          />
        </DrawerHeader>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {rows.map((row) => {
            const isOn = selectedSet.has(row.name)
            // Zero under the current filters: still listed (this is who set on the board), but
            // dimmed so the eye lands on the setters that would actually show something.
            const empty = row.count === 0
            const caption = problemCountLabel(row.count)
            return (
              <button
                key={row.name}
                type="button"
                aria-pressed={isOn}
                aria-label={isOn ? `Remove ${row.name} from the filter` : `Filter by ${row.name}, ${caption}`}
                onClick={() => toggle(row.name)}
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                  )}
                >
                  {isOn && <Check className="size-3.5" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-sm font-medium', empty && !isOn && 'text-muted-foreground')}>
                    {row.name}
                  </span>
                  <span className={cn('text-xs tabular-nums', empty ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
                    {caption}
                  </span>
                </span>
              </button>
            )
          })}

          {rows.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              {query.trim() ? `No setters match “${query.trim()}”` : 'No setters on this board yet'}
            </div>
          )}

          {hidden > 0 && (
            <div className="px-2 pt-2 text-center text-xs text-muted-foreground">
              {query.trim()
                ? `${hidden} more match — keep typing to narrow`
                : `${hidden} more ${hidden === 1 ? 'setter' : 'setters'} — type to search`}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
