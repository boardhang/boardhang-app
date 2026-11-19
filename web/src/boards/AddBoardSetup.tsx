// Add a board, step 2 of 2: "How is it set up?". The angle and hold sets are a draft
// held here; nothing reaches the board store until "Add board" is pressed, so leaving
// the page any other way adds nothing.
//
// The draft starts from the store's values for the board: the defaults for a board
// never added, or the remembered setup for one that was added and removed earlier.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import type { CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import { catalogNavTarget } from '../catalog/catalogNav'
import { useBottomSlot } from '../shell/bottomSlot'
import { Button } from '@/components/ui/button'
import { AddBoardHeader } from './AddBoardHeader'
import { BoardSetupFields } from './BoardSetupFields'
import { setupSummary } from './boardDisplay'
import { useGoBack } from './useGoBack'

export function AddBoardSetup({ board }: { board: CatalogBoardDef }) {
  const navigate = useNavigate()
  // Step 1 is the entry behind this one; a deep link has none, so go there directly.
  const back = useGoBack('/boards/add')
  const bottomSlot = useBottomSlot()
  const { addBoard, setAngle, setActiveHoldSetsRaw, activateBoard } = useBoardStore()
  const [angle, setDraftAngle] = useState(() => getAngle(board))
  const [holdSetsRaw, setDraftHoldSetsRaw] = useState(() => getActiveHoldSetsRaw(board.layoutId))

  const { filterable, active: selected } = holdSetContext(board.membershipResource, holdSetsRaw)

  function commit() {
    // `addBoard` leaves the active board alone when another board is already active,
    // so the new board is made active explicitly.
    addBoard(board.layoutId)
    setAngle(board.layoutId, angle)
    setActiveHoldSetsRaw(board.layoutId, holdSetsRaw)
    activateBoard(board.layoutId)
    // Replace this step, so Back from the catalog does not re-enter a finished flow.
    void navigate({ ...catalogNavTarget(board), replace: true })
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <AddBoardHeader
        step={2}
        title="How is it set up?"
        onBack={back}
      />
      <BoardSetupFields
        board={board}
        angle={angle}
        holdSetsRaw={holdSetsRaw}
        onAngle={setDraftAngle}
        onHoldSetsRaw={setDraftHoldSetsRaw}
      />
      {/* Docked in the shell's slot above the bottom bar: it never scrolls away and
          never covers the controls. */}
      {bottomSlot &&
        createPortal(
          <div className="flex items-center gap-3 border-t border-border bg-background px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{board.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {setupSummary(angle, selected.size, filterable.length)}
              </div>
            </div>
            <Button size="lg" className="px-4" onClick={commit}>
              Add board
            </Button>
          </div>,
          bottomSlot,
        )}
    </div>
  )
}
