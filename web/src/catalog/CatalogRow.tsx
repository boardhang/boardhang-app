// A single catalog problem row: name, benchmark/favorite badges, star rating,
// repeat count, method, setter (or hold count), a trailing grade pill, and an
// optional board thumbnail. Mirrors iOS CatalogListView's row. Clickable — opens
// the detail pager (U11). In a collaboration session a third row carries the "sends
// pill" — who in the crew has sent this problem (see useMemberSenders).

import { BadgeCheck, CheckCircle2, Heart } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogProblem } from './catalogSync'
import type { SenderChip } from './useMemberSenders'
import { ProblemMeta } from './ProblemMeta'
import { MemberAvatar } from '../sessions/MemberAvatar'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/** Max sender avatars in the pill before the +K overflow count (P4). */
const SENDER_CAP = 3

/** "Sent by You, Bob, +2" — the accessible summary for the sends pill. */
function sendersAriaLabel(senders: SenderChip[]): string {
  const shown = senders.slice(0, SENDER_CAP).map((s) => s.label)
  const extra = senders.length - shown.length
  return `Sent by ${[...shown, ...(extra > 0 ? [`+${extra}`] : [])].join(', ')}`
}

interface CatalogRowProps {
  problem: CatalogProblem
  board: CatalogBoardDef
  isFavorite?: boolean
  /** The user has a logged send for this problem — shows the green name-line check (iOS parity).
   *  Suppressed only when the send is already shown by self's own avatar in the sends pill, so
   *  a session whose projection is still loading/stale never hides a known send (P1/P3). */
  isSent?: boolean
  /** Crew members (self included, self first) who have sent this problem — the sends pill (P2/P3). */
  senders?: SenderChip[]
  /** The projection is paused/stale/offline — dim the last-known sends pill (P5). */
  sendersDimmed?: boolean
  /** Show the board thumbnail (iOS "climb previews" toggle). */
  showThumbnail?: boolean
  /** "col-row" positions from the active holds filter to ring on the thumbnail. */
  highlightHolds?: Set<string>
  onSelect?: (problem: CatalogProblem) => void
}

export function CatalogRow({
  problem,
  board,
  isFavorite = false,
  isSent = false,
  senders,
  sendersDimmed = false,
  showThumbnail = false,
  highlightHolds,
  onSelect,
}: CatalogRowProps) {
  // Suppress the name-line self-check only once self is actually represented in the pill — not
  // merely because a session is active. While the crew projection is loading or max-age-stale
  // (empty map, no pill), the local self-check stays as the fallback so a known send is never
  // hidden with nowhere to show.
  const selfInPill = senders?.some((s) => s.isSelf) ?? false
  return (
    <button
      type="button"
      onClick={() => onSelect?.(problem)}
      className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent"
    >
      {showThumbnail && (
        <div className="w-[72px] shrink-0">
          <CatalogBoard board={board} holds={problem.holds} highlightHolds={highlightHolds} />
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
          {/* Shown unless self's send is already carried by the pill below (P1/P3). */}
          {isSent && !selfInPill && (
            <CheckCircle2 role="img" aria-label="Sent" className="size-4 shrink-0 text-success" />
          )}
          {isFavorite && (
            <Heart role="img" aria-label="Favorite" className="size-3.5 shrink-0 fill-favorite text-favorite" />
          )}
        </div>
        <ProblemMeta problem={problem} />
        {senders && senders.length > 0 && (
          <div
            role="img"
            aria-label={sendersAriaLabel(senders)}
            className={cn(
              'mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary py-1 pr-2 pl-1.5',
              sendersDimmed && 'opacity-50',
            )}
          >
            {/* Decorative: the pill's aria-label already conveys "Sent by …" as one unit (role=img). */}
            <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-success" />
            <AvatarGroup className="-space-x-1.5">
              {senders.slice(0, SENDER_CAP).map((s) => (
                <MemberAvatar
                  key={s.userId}
                  initials={s.initials}
                  avatarUrl={s.avatarUrl}
                  isSelf={s.isSelf}
                  title={s.label}
                  size="xxs"
                  opaque
                />
              ))}
              {senders.length > SENDER_CAP && (
                <AvatarGroupCount>+{senders.length - SENDER_CAP}</AvatarGroupCount>
              )}
            </AvatarGroup>
          </div>
        )}
      </div>
      <span className="shrink-0 rounded-md bg-secondary px-2.5 py-1 text-sm font-bold tabular-nums text-secondary-foreground">
        {problem.grade}
      </span>
    </button>
  )
}
