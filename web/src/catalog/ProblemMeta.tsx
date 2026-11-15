// The catalog problem metadata line: star rating, repeat count, method, and setter
// (or a hold-count fallback when there's no setter). Shared by CatalogRow and the
// last-opened bar so the preview reads identically to the list. The detail view lays
// the same data out differently (larger header) and does not use this.

import { Repeat, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CatalogProblem } from './catalogSync'

/** The foot-rule label ("No kickboard", "Footless", ...) as a quiet outline chip: it stands
 *  out from the surrounding meta text by shape, not colour, so it doesn't compete with the
 *  grade pill. Shared with the problem-detail header. */
export function MethodChip({ method, className }: { method: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-[1.125rem] border-foreground/15 px-1.75 text-[0.6875rem] font-normal text-foreground/70',
        className,
      )}
    >
      {method}
    </Badge>
  )
}

export function ProblemMeta({ problem }: { problem: CatalogProblem }) {
  const subtitle = problem.setter ? `by ${problem.setter}` : `${problem.holds.length} holds`
  return (
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
      {problem.method && <MethodChip method={problem.method} />}
      <span className="truncate">{subtitle}</span>
    </div>
  )
}
