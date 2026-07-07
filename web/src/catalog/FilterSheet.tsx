// Filter FAB + swipe drawer, iOS-style: a floating button with an active-filter
// count badge opens a bottom drawer holding all the filter and sort controls.
// Uses the same shadcn Drawer (swipe handle) as the board config. Search stays in
// the catalog top bar. Positioning is owned by the parent's shared FAB column
// (CatalogScreen) — this renders the trigger only, not its own sticky wrapper.

import { SlidersHorizontal } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { FilterControls } from './FilterControls'
import { FabTrigger } from './FabTrigger'
import { activeFilterCount, hasActiveFilters, resetFilters, type FilterState } from './filters'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

interface FilterSheetProps {
  state: FilterState
  onChange: (state: FilterState) => void
  board: CatalogBoardDef
  gradeSpan: [number, number]
  methods: string[]
  /** Signed in AND ascents loaded — gates the status filter's count + apply. */
  statusReady: boolean
  /** Definitively signed out — disables the status chips with a sign-in hint. */
  signedOut: boolean
}

export function FilterSheet({
  state,
  onChange,
  board,
  gradeSpan,
  methods,
  statusReady,
  signedOut,
}: FilterSheetProps) {
  const count = activeFilterCount(state, statusReady)
  return (
    <Drawer showSwipeHandle>
      {/* Positioned by the parent's shared FAB column (CatalogScreen). */}
      <FabTrigger aria-label="Filters">
        <SlidersHorizontal className="size-6" strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[0.7rem] font-semibold text-white">
            {count}
          </span>
        )}
      </FabTrigger>
      <DrawerContent>
        {/* Center the sheet content to the app's column width — .app-shell caps the
            app at max-width:480px, but the drawer portals to a full-width bottom sheet,
            so without this the content stretches edge-to-edge on wide screens. */}
        <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
          <DrawerHeader className="flex flex-row items-center justify-between gap-2">
            <DrawerTitle>Filters</DrawerTitle>
            {hasActiveFilters(state, statusReady) && (
              <Button variant="ghost" size="sm" onClick={() => onChange(resetFilters(state))}>
                Clear filters
              </Button>
            )}
          </DrawerHeader>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <FilterControls
              state={state}
              onChange={onChange}
              board={board}
              gradeSpan={gradeSpan}
              methods={methods}
              statusReady={statusReady}
              signedOut={signedOut}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
