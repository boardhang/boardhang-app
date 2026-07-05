// "My Boards": the boards the user owns (add / activate / remove) plus per-board
// configuration — angle and installed hold sets, which drive the catalog's slab
// and climbable filtering. Also the first-run surface (zero added boards).

import { BOARDS, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import {
  activeCsv,
  activeSetIds,
  filterableSetIds,
  membershipFor,
} from '../board/holdSetMembership'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Toggle } from '@/components/ui/toggle'

interface MyBoardsProps {
  /** Jump to the catalog after activating a board. */
  onActivated: () => void
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
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My boards
          </h2>
          {addedBoards.map((board) => (
            <BoardCard
              key={board.layoutId}
              board={board}
              active={board.layoutId === activeBoard.layoutId}
              onActivate={() => {
                activateBoard(board.layoutId)
                onActivated()
              }}
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
              <span>{board.name}</span>
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
  onActivate: () => void
  onRemove: () => void
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
}

function BoardCard({ board, active, onActivate, onRemove, onAngle, onHoldSets }: BoardCardProps) {
  const angle = getAngle(board)
  const membership = membershipFor(board.membershipResource)
  const filterable = filterableSetIds(membership)
  const installed = activeSetIds(getActiveHoldSetsRaw(board.layoutId), membership)

  function toggleSet(id: number) {
    const next = new Set(installed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Never allow zero installed sets — an empty selection means "all".
    if (next.size === 0) return
    onHoldSets(activeCsv(next, membership))
  }

  const setName = (id: number) => membership.sets.find((s) => s.id === id)?.name ?? `Set ${id}`

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {board.name}
          {active && (
            <Badge variant="secondary" className="ml-2 align-middle">
              Active
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-1">
          {!active && (
            <Button size="sm" onClick={onActivate}>
              Browse
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasAngleChoice(board) && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Angle</span>
            {board.angles.map((a) => (
              <Toggle
                key={a}
                size="sm"
                variant="outline"
                pressed={angle === a}
                onPressedChange={() => onAngle(a)}
              >
                {a}°
              </Toggle>
            ))}
          </div>
        )}
        {filterable.length > 0 && (
          <div>
            <div className="mb-1 text-sm text-muted-foreground">Installed hold sets</div>
            <div className="flex flex-wrap gap-1.5">
              {filterable.map((id) => (
                <Toggle
                  key={id}
                  size="sm"
                  variant="outline"
                  pressed={installed.has(id)}
                  onPressedChange={() => toggleSet(id)}
                >
                  {setName(id)}
                </Toggle>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
