// Recents FAB + bottom sheet, iOS-style (mirrors CatalogListView's recentFAB /
// recentSheet): a floating History button opens a "Recently viewed" drawer listing
// the recent problems for this board+angle. Self-resolves its data from the recents
// store against the full slab and renders nothing when there's no history, so the
// FAB simply disappears. Positioning is owned by the parent's shared FAB column.

import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogRow } from './CatalogRow'
import type { CatalogProblem } from './catalogSync'
import { clearRecents, useRecents } from './recentsStore'
import { useShowPreviews } from './previewsStore'
import { FabTrigger } from './FabTrigger'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'

interface RecentsSheetProps {
  board: CatalogBoardDef
  angle: number
  /** The full (unfiltered) slab — recents are resolved against it, filter-independent. */
  problems: CatalogProblem[]
  favoriteIds: Set<string>
  onSelect: (problem: CatalogProblem) => void
}

export function RecentsSheet({ board, angle, problems, favoriteIds, onSelect }: RecentsSheetProps) {
  const [open, setOpen] = useState(false)
  const showThumbnails = useShowPreviews()
  const recentIds = useRecents(board.layoutId, angle)

  // Resolve ids to problems against the full slab, preserving recents order and
  // dropping any not present in this board+angle (iOS parity).
  const recentProblems = useMemo(() => {
    const byId = new Map(problems.map((p) => [p.source_catalog_id, p]))
    return recentIds
      .map((id) => byId.get(id))
      .filter((p): p is CatalogProblem => p !== undefined)
  }, [problems, recentIds])

  // The Drawer stays mounted so "Clear" (which empties recentProblems) closes it
  // through its exit animation instead of yanking it out of the tree. Only the FAB
  // trigger is gated on history: no recents → no FAB (no empty state needed; iOS parity).
  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      {/* Positioned by the parent's shared FAB column (CatalogScreen). */}
      {recentProblems.length > 0 && (
        <FabTrigger aria-label="Recently viewed">
          <History className="size-6" />
        </FabTrigger>
      )}
      <DrawerContent>
        <DrawerHeader className="flex flex-row items-center justify-between">
          <DrawerTitle>Recently viewed</DrawerTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              clearRecents(board.layoutId, angle)
            }}
          >
            Clear
          </Button>
        </DrawerHeader>
        <div className="max-h-[70vh] overflow-y-auto pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {recentProblems.map((p) => (
            <CatalogRow
              key={p.source_catalog_id}
              problem={p}
              board={board}
              isFavorite={favoriteIds.has(p.source_catalog_id)}
              showThumbnail={showThumbnails}
              onSelect={(problem) => {
                setOpen(false)
                onSelect(problem)
              }}
            />
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
