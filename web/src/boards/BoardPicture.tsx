// A board's picture with no problem on it: the background and the chosen hold
// sets' art. Shared by the tiles and the setup fields.

import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { cn } from '@/lib/utils'

interface BoardPictureProps {
  board: CatalogBoardDef
  /** Hold sets drawn; all of the board's sets when omitted. */
  visibleHoldSetIds?: Set<number>
  className?: string
}

export function BoardPicture({ board, visibleHoldSetIds, className }: BoardPictureProps) {
  return (
    <div className={cn('overflow-hidden rounded-md', className)}>
      <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visibleHoldSetIds} />
    </div>
  )
}
