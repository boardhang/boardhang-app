// The collapsed form of the sticky session bar: once the catalog list scrolls, the
// full ActiveBar folds away and this floating rounded pill takes over, docked
// centered on the header's bottom border. Its zero-height wrapper means the header
// gives back the bar's entire row — the pill overlays the top sliver of the list
// instead (dimmed by its own backdrop).
//
// Contents: the lit problem ("on the wall") + Queue/Share actions. Tapping the lit
// problem opens its detail view (mirrors LitProblemRow); the chevron re-expands the
// full bar in place (see useScrollCollapse) — when nothing is lit the text area
// expands directly and shows session name + member count instead.
//
// The pill positions wrapper-relative `absolute`, not `fixed`: the frosted header's
// backdrop-filter makes the header the containing block for positioned descendants,
// so viewport coordinates would render offset by the header's own origin. The wrapper
// rides the sticky header, so the pill holds its spot while the list scrolls.

import { ChevronDown, Lightbulb, Share2, Users } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { QueueDrawer } from '../sessions/QueueDrawer'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SessionBarPillProps {
  board: CatalogBoardDef
  sessionName: string
  rosterCount: number
  /** The lit problem id, or null when nothing is on the wall. */
  litProblemId: string | null
  /** Resolved catalog problem for litProblemId (null while unresolved). */
  litProblem: CatalogProblem | null
  onExpand: () => void
  onShare: () => void
  onOpenProblem: (id: string, stack?: CatalogProblem[]) => void
}

export function SessionBarPill({
  board,
  sessionName,
  rosterCount,
  litProblemId,
  litProblem,
  onExpand,
  onShare,
  onOpenProblem,
}: SessionBarPillProps) {
  return (
    <div className="relative h-0">
      <div
        className={cn(
          'absolute z-30 flex h-8 items-center gap-1 rounded-full border border-border bg-muted/90 px-1 shadow-sm backdrop-blur-md duration-200 animate-in fade-in zoom-in-95 motion-reduce:animate-none',
          // Docked centered, 8px below the header's bottom border. Margin-auto
          // centering, not translate — tw-animate's enter transform would fight it.
          'inset-x-0 top-4 mx-auto w-fit max-w-full',
        )}
      >
        <button
          type="button"
          onClick={() => (litProblemId ? onOpenProblem(litProblemId) : onExpand())}
          aria-label={litProblemId ? 'Open the problem that’s on the wall' : 'Expand session details'}
          title={litProblemId ? 'Open the problem that’s on the wall' : undefined}
          className="flex h-full min-w-0 items-center gap-1.5 pl-1.5 pr-1 text-left"
        >
          {litProblemId ? (
            <>
              <Lightbulb className="size-4 shrink-0 fill-current text-primary" aria-hidden />
              <span className="min-w-0 truncate text-sm font-medium">
                {litProblem ? litProblem.name : 'a climb'}
              </span>
              {litProblem && (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                  {litProblem.grade}
                </span>
              )}
            </>
          ) : (
            <>
              <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate text-sm font-medium">{sessionName}</span>
              {rosterCount > 0 && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{rosterCount}</span>
              )}
            </>
          )}
        </button>
        <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <QueueDrawer board={board} compact onOpenProblem={onOpenProblem} triggerClassName="size-7 rounded-full" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={onShare}
          aria-label="Share session"
        >
          <Share2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={onExpand}
          aria-expanded={false}
          aria-controls="session-bar-full"
          aria-label="Expand session details"
        >
          <ChevronDown className="size-4" />
        </Button>
      </div>
    </div>
  )
}
