// The per-member "Ascent status" body for an active session: the paused affordance plus one
// MemberStatusRow per member (self first). Shared by BOTH status surfaces so they can't drift —
// the Filters sheet (FilterControls) and the pinned nav control (FacetControlPopover). In a
// session status is per-member state in the sessions store, not FilterState.statusFilters, so
// this reads its rows from useSessionFilterRows rather than taking a FilterState.

import { RefreshCw } from 'lucide-react'
import { MemberStatusRow } from './MemberStatusRow'
import type { SessionFilterUI } from './useSessionFilterRows'
import { cn } from '@/lib/utils'

interface SessionStatusRowsProps {
  session: SessionFilterUI
  /** Height cap for the scrolling row list — the sheet has more room than the nav popover. */
  scrollClassName?: string
}

export function SessionStatusRows({ session, scrollClassName }: SessionStatusRowsProps) {
  return (
    <div className="space-y-2">
      {session.state === 'paused' && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>Cross-member filtering paused — showing all problems.</span>
          <button
            type="button"
            onClick={session.onRefresh}
            className="flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
          >
            <RefreshCw className="size-3" />
            Refresh
          </button>
        </div>
      )}
      <div className={cn('space-y-2 overflow-y-auto', scrollClassName ?? 'max-h-52')}>
        {session.rows.map((row) => (
          <MemberStatusRow
            key={row.userId}
            label={row.label}
            initials={row.initials}
            avatarUrl={row.avatarUrl}
            isSelf={row.isSelf}
            ariaLabel={row.isSelf ? 'Your ascent status' : `${row.label}’s ascent status`}
            selected={row.selected}
            onToggle={row.onToggle}
            rowState={session.state === 'loading' ? 'loading' : 'ready'}
          />
        ))}
      </div>
    </div>
  )
}
