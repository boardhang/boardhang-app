// The per-member "Ascent status" body for an active session: the paused affordance plus ONE LINE
// per member (self first). Shared by BOTH status surfaces so they can't drift — the Filters sheet
// (FilterControls) and the pinned nav control (FacetControlPopover). In a session status is
// per-member state in the sessions store, not FilterState.statusFilters, so this reads its rows
// from useSessionFilterRows rather than taking a FilterState.
//
// One line per member is the load-bearing constraint. Three free-standing Toggles beside an avatar
// wrap at popover width, which turned every member into a two-line block with the avatar floating
// in the middle of it and no name anywhere — six members read as eighteen loose buttons. Here the
// three chips are welded into a single segmented control (ToggleGroup, spacing={0}) so they read as
// ONE control with three states, and the member's name is visible rather than hidden behind a hover
// tooltip (there is no hover on a phone, so an avatar-only row was unidentifiable to touch users).
// Because every row carries the same three labels the control has the same intrinsic width in each,
// so the segment boundaries line up into columns for free — "who has Sent on?" scans straight down.
//
// Multi-select is preserved: base-ui's ToggleGroup fires each item's `onPressedChange` before it
// commits the group value, so we keep the per-key `row.onToggle(key, active)` contract and stay
// fully controlled off `row.selected` — the sessions store is the single source of truth, and the
// group must never hold its own copy. FilterControls.test covers that this actually fires.

import { RefreshCw } from 'lucide-react'
import { STATUS_KEYS, STATUS_LABELS, type StatusKey } from './filters'
import type { MemberFilterRow, SessionFilterUI } from './useSessionFilterRows'
import { MemberAvatar } from '../sessions/MemberAvatar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Line-length labels for the segments. The canonical STATUS_LABELS are written to stand alone
 *  ("Attempted", "Not logged"); inside a labelled row they only have to distinguish three options,
 *  and the budget is ~150px for all three. "Attempted" → "Tried" is the word climbers actually use
 *  and buys ~25px for names. "Not logged" → "Unlogged" collapses two words into one so the segment
 *  can never wrap — deliberately NOT "None", which reads as "nothing selected" rather than "no
 *  ascent recorded". These are local to this control: STATUS_LABELS stays canonical everywhere else
 *  (chips, the pinned control's label, the single-user row), and survives here as the hover title. */
const SEGMENT_LABELS: Record<StatusKey, string> = {
  sent: 'Sent',
  attempted: 'Tried',
  unlogged: 'Unlogged',
}

interface SessionStatusRowsProps {
  session: SessionFilterUI
  /** Height cap for the scrolling row list — the sheet has more room than the nav popover. */
  scrollClassName?: string
}

export function SessionStatusRows({ session, scrollClassName }: SessionStatusRowsProps) {
  const loading = session.state === 'loading'
  return (
    <div className="space-y-2">
      {session.state === 'paused' && <PausedNotice onRefresh={session.onRefresh} />}
      {/* Hairlines instead of gaps: the rows are the design, so separate them the way a list is
          separated, not the way a stack of cards is. The negative margin keeps the scrollbar off
          the segmented control once the list passes ~6 members. */}
      <div
        className={cn(
          '-mr-1 divide-y divide-border/60 overflow-y-auto pr-1',
          scrollClassName ?? 'max-h-56',
        )}
      >
        {session.rows.map((row) => (
          <MemberLine key={row.userId} row={row} loading={loading} />
        ))}
      </div>
    </div>
  )
}

/** One member: identity on the left, their whole selection in one control on the right. */
function MemberLine({ row, loading }: { row: MemberFilterRow; loading: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <MemberAvatar initials={row.initials} avatarUrl={row.avatarUrl} isSelf={row.isSelf} />
      {/* min-w-0 lets the name be the only thing that gives way — the segmented control must never
          shrink, or the segments stop lining up between rows. */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs text-foreground',
          row.isSelf && 'font-semibold',
        )}
      >
        {row.label}
      </span>
      <ToggleGroup
        multiple
        role="group"
        variant="outline"
        size="sm"
        spacing={0}
        value={row.selected}
        disabled={loading}
        aria-busy={loading}
        // Exact strings (curly apostrophe) — screen readers and the tests key off them.
        aria-label={row.isSelf ? 'Your ascent status' : `${row.label}’s ascent status`}
        className="shrink-0"
      >
        {STATUS_KEYS.map((k) => (
          <ToggleGroupItem
            key={k}
            value={k}
            // `title` carries the canonical wording without overriding the accessible name: the
            // visible text stays the name, so voice control ("click Tried") matches the screen.
            title={STATUS_LABELS[k]}
            onPressedChange={(active) => row.onToggle(k, active)}
            className="h-6 px-2 text-[0.6875rem]"
          >
            {SEGMENT_LABELS[k]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** Paused = the projection is stale/errored, so cross-member filtering is off and the list is
 *  widened. Selections stay untouched and interactive: they are what the user gets back the moment
 *  the refresh lands, so hiding or disabling them would look like data loss. */
function PausedNotice({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex items-start justify-between gap-1.5 rounded-md border border-border bg-muted px-2 py-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
      <span>Cross-member filtering paused — showing all problems.</span>
      <Button
        variant="ghost"
        size="xs"
        onClick={onRefresh}
        className="-my-0.5 -mr-1 shrink-0 px-1.5 text-[0.6875rem] text-foreground"
      >
        <RefreshCw aria-hidden className="size-3" />
        Refresh
      </Button>
    </div>
  )
}
