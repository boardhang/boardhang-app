// A horizontal strip of the session queue, shown inside the problem detail whenever the board's
// session queue is non-empty (independent of how the drawer was opened — the caller reads the live
// queue via useActiveQueueProblems). It gives a visual overview of what's up next and a tap-to-jump
// alongside the pager's prev/next: each card pages the detail to that climb (and, where the host
// supports it, hands prev/next off to the queue's order), and the currently-shown one is
// highlighted when it happens to be queued. Mirrors the BetaVideos strip's section styling
// (uppercase muted heading + a snap-x scroll row of fixed-width cards).

import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogProblem } from './catalogSync'
import { cn } from '@/lib/utils'

interface ProblemDetailQueueStripProps {
  /** The queue's active items in order (the pager domain) — one card each. */
  items: CatalogProblem[]
  /** The problem currently shown in the detail — its card is highlighted. */
  currentId: string
  board: CatalogBoardDef
  /** Follow the catalog "climb previews" toggle, as the queue/recents rows do. */
  showThumbnail?: boolean
  /** Page the detail to this problem (replace-navigates ?problem). */
  onSelect: (id: string) => void
}

export function ProblemDetailQueueStrip({
  items,
  currentId,
  board,
  showThumbnail = true,
  onSelect,
}: ProblemDetailQueueStripProps) {
  return (
    <section aria-label="Queue" className="space-y-1.5">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Up next
      </h2>
      <ol className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {items.map((p, i) => {
          const active = p.source_catalog_id === currentId
          return (
            <li key={p.source_catalog_id} className="shrink-0 snap-start">
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(p.source_catalog_id)}
                className={cn(
                  'flex w-24 flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors',
                  active ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/50',
                )}
              >
                {showThumbnail && (
                  <div className="overflow-hidden rounded">
                    <CatalogBoard board={board} holds={p.holds} />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[0.7rem] font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold uppercase tracking-tight">
                    {p.name}
                  </span>
                </div>
                <span className="w-fit rounded bg-secondary px-1 py-0.5 text-[0.65rem] font-bold tabular-nums text-secondary-foreground">
                  {p.grade}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
