// A single catalog problem row: name, benchmark/favorite badges, star rating,
// repeat count, method, setter (or hold count), a trailing grade pill, and an
// optional board thumbnail. Mirrors iOS CatalogListView's row. Clickable — opens
// the detail pager (U11).

import { BadgeCheck, Heart, Repeat, Star } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogProblem } from './catalogSync'

interface CatalogRowProps {
  problem: CatalogProblem
  board: CatalogBoardDef
  isFavorite?: boolean
  /** Show the board thumbnail (iOS "climb previews" toggle). */
  showThumbnail?: boolean
  onSelect?: (problem: CatalogProblem) => void
}

export function CatalogRow({
  problem,
  board,
  isFavorite = false,
  showThumbnail = false,
  onSelect,
}: CatalogRowProps) {
  const subtitle = problem.setter ? `by ${problem.setter}` : `${problem.holds.length} holds`
  return (
    <button
      type="button"
      onClick={() => onSelect?.(problem)}
      className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent"
    >
      {showThumbnail && (
        <div className="w-12 shrink-0">
          <CatalogBoard board={board} holds={problem.holds} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold uppercase tracking-tight">
            {problem.name}
          </span>
          {problem.is_benchmark && (
            <BadgeCheck role="img" aria-label="Benchmark" className="size-4 shrink-0 text-benchmark" />
          )}
          {isFavorite && (
            <Heart role="img" aria-label="Favorite" className="size-3.5 shrink-0 fill-favorite text-favorite" />
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
          {problem.stars > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Star className="size-3" /> {problem.stars}
            </span>
          )}
          {problem.repeats > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Repeat className="size-3" /> {problem.repeats}
            </span>
          )}
          {problem.method && <span className="shrink-0 text-foreground/70">{problem.method}</span>}
          <span className="truncate">{subtitle}</span>
        </div>
      </div>
      <span className="shrink-0 rounded-md bg-secondary px-2.5 py-1 text-sm font-bold tabular-nums text-secondary-foreground">
        {problem.grade}
      </span>
    </button>
  )
}
