// Filter FAB + swipe drawer, iOS-style: a floating button with an active-filter
// count badge opens a bottom drawer holding all the filter and sort controls.
// Uses the same shadcn Drawer (swipe handle) as the board config. Search stays in
// the catalog top bar. Positioning is owned by the parent's shared FAB column
// (CatalogScreen) — this renders the trigger only, not its own sticky wrapper.

import { SlidersHorizontal } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import type { SavedList } from '../lists/listsTypes'
import { FilterControls } from './FilterControls'
import { sessionStatusFacet, useSessionFilterRows } from './useSessionFilterRows'
import { FabTrigger } from './FabTrigger'
import { activeFilterCount, hasActiveFilters, resetFilters, type FilterState } from './filters'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

interface FilterSheetProps {
  state: FilterState
  onChange: (state: FilterState) => void
  board: CatalogBoardDef
  gradeSpan: [number, number]
  /** Signed in AND ascents loaded — gates the status filter's count + apply. */
  statusReady: boolean
  /** Definitively signed out — disables the status chips with a sign-in hint. */
  signedOut: boolean
  /** This board's live lists — the "Saved lists" pills inside the sheet. */
  boardLists: SavedList[]
}

export function FilterSheet({
  state,
  onChange,
  board,
  gradeSpan,
  statusReady,
  signedOut,
  boardLists,
}: FilterSheetProps) {
  // In a session the single-user statusFilters dimension is inert (self is a member row),
  // so count it only when solo; add 1 when per-member status is actually narrowing the list.
  // Same readiness-gated selector the header uses — a badge that counts a paused (therefore
  // unapplied) filter would overstate what the list is showing.
  const session = useSessionFilterRows(board)
  const status = sessionStatusFacet(session)
  // The badge counts only APPLIED filters: it is a bare number with no room to express "set but
  // paused", so counting a paused filter would overstate what the list is showing. (The pinned
  // control and the chip can express it, and do — they render dashed and dimmed.)
  const sessionStatusActive = status.members > 0 && status.applied
  // Clear keys off "are there selections", not "are they applied": paused selections still exist
  // and reapply on refresh, so Clear must stay reachable.
  const sessionStatusClearable = status.members > 0
  const count = activeFilterCount(state, session ? false : statusReady) + (sessionStatusActive ? 1 : 0)
  // "Clear filters" must clear everything the badge counted — including per-member status, which
  // resetFilters can't touch (it returns a FilterState; that state lives in the sessions store).
  const clearAll = () => {
    onChange(resetFilters(state))
    session?.onClearAll()
  }
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
        <DrawerHeader className="flex flex-row items-center justify-between gap-2">
          <DrawerTitle>Filters</DrawerTitle>
          {(hasActiveFilters(state, session ? false : statusReady) || sessionStatusClearable) && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
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
            statusReady={statusReady}
            signedOut={signedOut}
            boardLists={boardLists}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
