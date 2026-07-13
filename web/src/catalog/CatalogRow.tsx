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
  /** The user has a logged send for this problem — shows the green sent check (iOS parity).
   *  Suppressed in a session (`sessionActive`): the send is shown in the sends pill instead. */
  isSent?: boolean
  /** A collaboration session is active on this board — moves send status to the sends pill and
   *  suppresses the name-line self-check so it isn't shown twice (P1/P3). */
  sessionActive?: boolean
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
  sessionActive = false,
  senders,
  sendersDimmed = false,
  showThumbnail = false,
  highlightHolds,
  onSelect,
}: CatalogRowProps) {
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
          {/* Solo: the send shows here. In a session it moves to the sends pill below (P1/P3). */}
          {isSent && !sessionActive && (
            <CheckCircle2 role="img" aria-label="Sent" className="size-4 shrink-0 text-success" />
          )}
          {isFavorite && (
            <Heart role="img" aria-label="Favorite" className="size-3.5 shrink-0 fill-favorite text-favorite" />
          )}
        </div>
        <ProblemMeta problem={problem} />
        {senders && senders.length > 0 && (
          <div
            aria-label={sendersAriaLabel(senders)}
            className={cn(
              'mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary py-1 pr-2 pl-1.5',
              sendersDimmed && 'opacity-50',
            )}
          >
            <CheckCircle2 role="img" aria-label="Sent" className="size-3.5 shrink-0 text-success" />
            <AvatarGroup className="-space-x-1.5">
              {senders.slice(0, SENDER_CAP).map((s) => (
                <MemberAvatar
                  key={s.userId}
                  initials={s.initials}
                  avatarUrl={s.avatarUrl}
                  isSelf={s.isSelf}
                  title={s.label}
                  size="xxs"
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
