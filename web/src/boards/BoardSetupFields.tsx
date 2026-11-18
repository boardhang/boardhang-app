// How a board is set up: its picture, the wall angle and the hold sets on the wall.
// Controlled, so the add flow can hold a draft and the edit page can write each
// change straight to the store. The hold-set value is the store's raw string
// ("" = every set), read and written through holdSetMembership.

import { hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { activeCsv, holdSetContext } from '../board/holdSetMembership'
import { Toggle } from '@/components/ui/toggle'
import { BoardPicture } from './BoardPicture'

interface BoardSetupFieldsProps {
  board: CatalogBoardDef
  angle: number
  /** The raw hold-set string, as `getActiveHoldSetsRaw` returns it. */
  holdSetsRaw: string
  onAngle: (angle: number) => void
  onHoldSetsRaw: (raw: string) => void
}

export function BoardSetupFields({
  board,
  angle,
  holdSetsRaw,
  onAngle,
  onHoldSetsRaw,
}: BoardSetupFieldsProps) {
  const { membership, filterable, active: selected, visible } = holdSetContext(
    board.membershipResource,
    holdSetsRaw,
  )
  const setName = (id: number) => membership.sets.find((s) => s.id === id)?.name ?? `Set ${id}`

  function toggleSet(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size === 0) return // empty = "all"; keep at least one
    onHoldSetsRaw(activeCsv(next, membership))
  }

  return (
    <div className="space-y-5">
      {/* Height-capped: the max-width is derived from the board's aspect ratio, so a
          tall board letterboxes narrower instead of pushing the controls off screen. */}
      <div
        className="mx-auto w-full"
        style={{ maxWidth: `calc(34vh * ${board.geometry.width} / ${board.geometry.height})` }}
      >
        <BoardPicture board={board} visibleHoldSetIds={visible} />
      </div>
      {hasAngleChoice(board) && (
        <div role="group" aria-label="Angle" className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Angle</div>
          <div className="flex gap-1.5">
            {board.angles.map((a) => (
              <Toggle key={a} variant="outline" pressed={angle === a} onPressedChange={() => onAngle(a)}>
                {a}°
              </Toggle>
            ))}
          </div>
        </div>
      )}
      {filterable.length > 0 && (
        <div role="group" aria-label="Hold sets on the wall" className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Hold sets on the wall</div>
          <div className="flex flex-wrap gap-1.5">
            {filterable.map((id) => (
              <Toggle
                key={id}
                size="sm"
                variant="outline"
                pressed={selected.has(id)}
                disabled={selected.size === 1 && selected.has(id)}
                onPressedChange={() => toggleSet(id)}
              >
                {setName(id)}
              </Toggle>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
