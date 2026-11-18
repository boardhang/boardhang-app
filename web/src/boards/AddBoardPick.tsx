// Add a board, step 1 of 2: "Which board?". Every board in the registry as a picture
// tile. A board that is already added says so and opens its edit page instead, so a
// second copy can never be added.

import { useNavigate } from '@tanstack/react-router'
import { BOARDS } from '../board/boards'
import { useBoardStore } from '../board/boardStore'
import { AddBoardHeader } from './AddBoardHeader'
import { BoardPicture } from './BoardPicture'
import { useGoBack } from './useGoBack'

export function AddBoardPick() {
  const navigate = useNavigate()
  const back = useGoBack()
  const { addedBoards } = useBoardStore()
  const addedIds = new Set(addedBoards.map((b) => b.layoutId))

  return (
    <div className="flex flex-1 flex-col gap-5">
      <AddBoardHeader step={1} title="Which board?" onBack={back} />
      <div className="grid grid-cols-2 gap-2">
        {BOARDS.map((board) => {
          const added = addedIds.has(board.layoutId)
          const params = { layoutId: String(board.layoutId) }
          return (
            <button
              key={board.layoutId}
              type="button"
              className="flex flex-col rounded-xl border p-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() =>
                void navigate(
                  added ? { to: '/boards/$layoutId/edit', params } : { to: '/boards/add/$layoutId', params },
                )
              }
            >
              <div className="flex w-full flex-1 items-center">
                <BoardPicture board={board} className="w-full" />
              </div>
              <div className="mt-2 text-sm font-medium">{board.name}</div>
              {added && <div className="text-xs text-muted-foreground">You have this one</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
