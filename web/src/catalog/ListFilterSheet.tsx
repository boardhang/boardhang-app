// Multi-select sheet for the catalog's saved-list filter (R3.1). Lists the current board's
// lists (a list binds one board), each with a checkbox that toggles its id in `listFilter`
// LIVE — every tap writes through onChange immediately, so the catalog updates behind the
// open sheet (mirrors AddToListSheet and the pill bar's instant controls; no Apply step, TD7).
// The lists come from CatalogScreen already board-scoped; this component only renders + toggles.

import { Check } from 'lucide-react'
import type { SavedList } from '../lists/listsTypes'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

interface ListFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** This board's live lists (already board-scoped by CatalogScreen). */
  boardLists: SavedList[]
  /** Currently-selected list ids. */
  selected: string[]
  /** Apply a new selection (writes through to the URL/seed via CatalogScreen). */
  onChange: (listIds: string[]) => void
}

export function ListFilterSheet({ open, onOpenChange, boardLists, selected, onChange }: ListFilterSheetProps) {
  const selectedSet = new Set(selected)

  const toggle = (listId: string) => {
    // Live: recompute the id set and hand it back immediately (no batched Apply).
    onChange(selectedSet.has(listId) ? selected.filter((id) => id !== listId) : [...selected, listId])
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        {/* Same centered content container as the filter bottom sheet: the drawer portals to a
            full-width bottom sheet, so cap it to the app column so rows/header don't stretch
            edge-to-edge on wide screens. */}
        <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
          <DrawerHeader className="pb-2">
            <div className="flex flex-row items-center justify-between gap-2">
              <DrawerTitle>Filter by list</DrawerTitle>
              {selected.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                  Clear all
                </Button>
              )}
            </div>
            <DrawerDescription className="text-left">
              Show only problems in the lists you pick.
            </DrawerDescription>
          </DrawerHeader>

          <div className="max-h-[60vh] space-y-1 overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {boardLists.map((list) => {
              const isOn = selectedSet.has(list.id)
              return (
                <button
                  key={list.id}
                  type="button"
                  aria-pressed={isOn}
                  aria-label={isOn ? `Remove ${list.name} from the filter` : `Filter by ${list.name}`}
                  onClick={() => toggle(list.id)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                  >
                    {isOn && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{list.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
