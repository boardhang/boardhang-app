// Filter FAB + swipe drawer, iOS-style: a floating button (above the bottom nav)
// with an active-filter count badge opens a bottom drawer holding all the filter
// and sort controls. Uses the same shadcn Drawer (swipe handle) as the board
// config. Search stays in the catalog top bar.

import { SlidersHorizontal } from 'lucide-react'
import { FilterControls } from './FilterControls'
import { activeFilterCount, type FilterState } from './filters'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'

interface FilterSheetProps {
  state: FilterState
  onChange: (state: FilterState) => void
  gradeSpan: [number, number]
  methods: string[]
}

export function FilterSheet({ state, onChange, gradeSpan, methods }: FilterSheetProps) {
  const count = activeFilterCount(state)
  return (
    <Drawer showSwipeHandle>
      {/* Sticky, not fixed: pinned a fixed gap above the scroll region's bottom
          (i.e. above the nav row) regardless of nav height. -mt-14 cancels the
          flow space so it overlaps the list end; pointer-events let taps through. */}
      <div className="pointer-events-none sticky bottom-4 z-30 -mt-14 flex justify-end">
        <DrawerTrigger
          aria-label="Filters"
          className="pointer-events-auto relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:opacity-90"
        >
          <SlidersHorizontal className="size-6" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-destructive text-[0.7rem] font-semibold text-white">
              {count}
            </span>
          )}
        </DrawerTrigger>
      </div>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <FilterControls state={state} onChange={onChange} gradeSpan={gradeSpan} methods={methods} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
