// Route components for the add and edit pages. The pages take their board as a prop;
// these read it off the URL. Each route's `beforeLoad` has already bounced an unknown
// layout id. Keyed by board, so a param change remounts the page with fresh state (a
// draft, an open remove confirm).

import { useParams } from '@tanstack/react-router'
import { boardByLayoutId } from '../board/boards'
import { AddBoardSetup } from './AddBoardSetup'
import { EditBoard } from './EditBoard'

export function AddBoardSetupRoute() {
  const { layoutId } = useParams({ from: '/boards/add/$layoutId' })
  const board = boardByLayoutId(Number(layoutId))!
  return <AddBoardSetup key={board.layoutId} board={board} />
}

export function EditBoardRoute() {
  const { layoutId } = useParams({ from: '/boards/$layoutId/edit' })
  const board = boardByLayoutId(Number(layoutId))!
  return <EditBoard key={board.layoutId} board={board} />
}
