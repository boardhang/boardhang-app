// The New-Benchmarks banner — winner locked in from the U2 design exploration.
//
// Warm amber accent, sparkle icon, "New" secondary badge, and a text-foreground "View" cue
// (no primary-color button, no filled background). Sits on the page's own background so it
// reads as good news rather than a system alert. See the PR conversation for the rejected
// variants (subtle / icon-badge / minimal-chip).

import { Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface NewBenchmarksBannerProps {
  count: number
  onView: () => void
  onDismiss: () => void
}

export function NewBenchmarksBanner({ count, onView, onDismiss }: NewBenchmarksBannerProps) {
  const label = count === 1 ? '1 new benchmark' : `${count} new benchmarks`
  return (
    <div
      role="status"
      data-testid="new-benchmarks-banner"
      className={cn(
        'relative flex items-center gap-3 border-b border-border',
        'px-3 py-2.5 min-h-11',
      )}
    >
      <button
        type="button"
        onClick={onView}
        aria-label={`View ${label}`}
        className={cn(
          'flex flex-1 items-center gap-2.5 text-left',
          '-my-2.5 py-2.5 pr-2',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
        )}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label} to try</span>
          <Badge
            variant="secondary"
            className="shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-300 border-transparent hover:bg-amber-500/20"
          >
            New
          </Badge>
        </span>
        <span className="shrink-0 text-xs font-medium text-foreground">View</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        aria-label={`Dismiss ${label}`}
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
