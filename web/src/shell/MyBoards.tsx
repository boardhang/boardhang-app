// "My Boards": the boards the user owns. Each board is a clean row (name +
// config summary). The active board shows a primary "Browse" action into its
// catalog; every other owned board shows a secondary "Set as active" that just
// switches the active board (staying on this list). Tapping the config button
// opens a bottom drawer to edit angle and installed hold sets (or remove it) —
// mirroring iOS, where board config lives behind a separate sheet. Also the
// first-run surface (zero added boards).

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { BOARDS, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { activeCsv, holdSetContext } from '../board/holdSetMembership'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

interface MyBoardsProps {
  /** Jump to the catalog after activating a board (given its layout id). */
  onActivated: (layoutId: number) => void
}

export function MyBoards({ onActivated }: MyBoardsProps) {
  const { addedBoards, activeBoard, addBoard, removeBoard, activateBoard, setAngle, setActiveHoldSetsRaw } =
    useBoardStore()
  const addedIds = new Set(addedBoards.map((b) => b.layoutId))
  const addable = BOARDS.filter((b) => !addedIds.has(b.layoutId))

  return (
    <div className="space-y-4">
      {addedBoards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Add your first board</p>
          <p className="text-sm">Pick the MoonBoard you have to start browsing its problems.</p>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My boards
          </h2>
          {addedBoards.map((board) => (
            <BoardCard
              key={board.layoutId}
              board={board}
              active={board.layoutId === activeBoard.layoutId}
              // Active board → browse its catalog (already active, no switch).
              onBrowse={() => onActivated(board.layoutId)}
              // Inactive board → just switch the active board; stay on this list.
              onSetActive={() => activateBoard(board.layoutId)}
              onRemove={() => removeBoard(board.layoutId)}
              onAngle={(angle) => setAngle(board.layoutId, angle)}
              onHoldSets={(csv) => setActiveHoldSetsRaw(board.layoutId, csv)}
            />
          ))}
        </section>
      )}

      {addable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add a board
          </h2>
          {addable.map((board) => (
            <div key={board.layoutId} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-sm">{board.name}</span>
              <Button size="sm" variant="outline" onClick={() => addBoard(board.layoutId)}>
                Add
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

interface BoardCardProps {
  board: CatalogBoardDef
  active: boolean
  onBrowse: () => void
  onSetActive: () => void
  onRemove: () => void
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
}

function BoardCard({ board, active, onBrowse, onSetActive, onRemove, onAngle, onHoldSets }: BoardCardProps) {
  const angle = getAngle(board)
  const { filterable, active: installed } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(board.layoutId),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const subtitle = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')

  return (
    <Card className={cn('py-3', active && 'border-primary/60 bg-primary/5')}>
      <CardContent className="flex items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{board.name}</span>
            {active && (
              <Badge className="shrink-0 bg-accent text-accent-foreground">Active</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {active ? (
          <Button size="sm" onClick={onBrowse}>
            Browse
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onSetActive}>
            Set as active
          </Button>
        )}
        <BoardConfigDrawer
          board={board}
          angle={angle}
          onAngle={onAngle}
          onHoldSets={onHoldSets}
          onRemove={onRemove}
        />
      </CardContent>
    </Card>
  )
}

interface BoardConfigDrawerProps {
  board: CatalogBoardDef
  angle: number
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
  onRemove: () => void
}

function BoardConfigDrawer({ board, angle, onAngle, onHoldSets, onRemove }: BoardConfigDrawerProps) {
  const { membership, filterable, active: installed } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(board.layoutId),
  )
  const [confirmRemove, setConfirmRemove] = useState(false)
  const setName = (id: number) => membership.sets.find((s) => s.id === id)?.name ?? `Set ${id}`

  function toggleSet(id: number) {
    const next = new Set(installed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size === 0) return // empty = "all"; keep at least one
    onHoldSets(activeCsv(next, membership))
  }

  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger
        aria-label={`Configure ${board.name}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings2 className="size-4" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{board.name}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-5 px-4 pb-8">
          {hasAngleChoice(board) && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Angle</div>
              <div className="flex gap-1.5">
                {board.angles.map((a) => (
                  <Toggle key={a} size="sm" variant="outline" pressed={angle === a} onPressedChange={() => onAngle(a)}>
                    {a}°
                  </Toggle>
                ))}
              </div>
            </div>
          )}
          {filterable.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Installed hold sets</div>
              <div className="flex flex-wrap gap-1.5">
                {filterable.map((id) => (
                  <Toggle
                    key={id}
                    size="sm"
                    variant="outline"
                    pressed={installed.has(id)}
                    disabled={installed.size === 1 && installed.has(id)}
                    onPressedChange={() => toggleSet(id)}
                  >
                    {setName(id)}
                  </Toggle>
                ))}
              </div>
            </div>
          )}
          <Button
            variant={confirmRemove ? 'destructive' : 'outline'}
            className="w-full"
            onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
          >
            {confirmRemove ? 'Confirm — remove this board' : 'Remove board'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
