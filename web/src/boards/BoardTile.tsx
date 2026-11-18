// A board as a small picture tile: the board's art, a title, an optional second
// line and its angle. Everything shown is an input, so the tile knows nothing about
// where a board comes from.
//
// The tile body and the corner action are sibling buttons (never nested), so each
// has its own tap target and its own accessible name.

import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { cn } from '@/lib/utils'
import { BoardPicture } from './BoardPicture'

export interface BoardTileCornerAction {
  icon: ReactNode
  /** Accessible name of the corner button. */
  label: string
  onClick: () => void
}

interface BoardTileProps {
  board: CatalogBoardDef
  /** Hold sets drawn on the picture; all of the board's sets when omitted. */
  visibleHoldSetIds?: Set<number>
  title: string
  /** An optional line under the title. */
  subtitle?: string
  angle: number
  /** The active board: outlined, and offers "Browse". */
  active: boolean
  /** Unseen new benchmarks on this board. */
  dot?: boolean
  /** Accessible name of the tile body. */
  label: string
  onSelect: () => void
  corner?: BoardTileCornerAction
}

export function BoardTile({
  board,
  visibleHoldSetIds,
  title,
  subtitle,
  angle,
  active,
  dot = false,
  label,
  onSelect,
  corner,
}: BoardTileProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-xl border p-1.5',
        active && 'border-primary bg-primary/5 ring-1 ring-primary',
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        className="flex flex-1 flex-col rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onSelect}
      >
        <div className="flex w-full flex-1 items-center">
          <BoardPicture board={board} visibleHoldSetIds={visibleHoldSetIds} className="w-full" />
        </div>
        <div className="mt-1.5 w-full truncate text-xs font-medium">{title}</div>
        {subtitle && <div className="w-full truncate text-[11px] text-muted-foreground">{subtitle}</div>}
        <div className="flex w-full items-center justify-between text-[11px] text-muted-foreground">
          <span>{angle}°</span>
          {active && (
            <span className="flex items-center gap-0.5 font-medium text-primary">
              Browse <ArrowRight className="size-3" />
            </span>
          )}
        </div>
      </button>
      {dot && (
        <span
          data-testid={`new-benchmarks-dot-${board.layoutId}`}
          className="pointer-events-none absolute top-3 left-3 size-2.5 rounded-full bg-primary ring-2 ring-background"
        >
          <span className="sr-only">New benchmarks</span>
        </span>
      )}
      {corner && (
        // A 40px hit area around the 28px circle, so the corner is not a fiddly target.
        <button
          type="button"
          aria-label={corner.label}
          className="group/corner absolute top-1 right-1 flex size-10 items-center justify-center rounded-full outline-none"
          onClick={corner.onClick}
        >
          <span className="flex size-7 items-center justify-center rounded-full border bg-background/85 text-foreground backdrop-blur group-focus-visible/corner:ring-3 group-focus-visible/corner:ring-ring/50 [&_svg]:size-3.5">
            {corner.icon}
          </span>
        </button>
      )}
    </div>
  )
}
