// A single catalog problem row: name, benchmark/favorite badges, star rating,
// repeat count, method, setter (or hold count), a trailing grade pill, and an
// optional board thumbnail. Mirrors iOS CatalogListView's row. Clickable — opens
// the detail pager (U11). In a collaboration session a third row carries the "sends
// pill" — who in the crew has sent this problem (see useMemberSenders).

import { useRef } from 'react'
import { BadgeCheck, CheckCircle2, Heart, Plus } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogProblem } from './catalogSync'
import type { SenderChip } from './useMemberSenders'
import { ProblemMeta } from './ProblemMeta'
import { MemberAvatar } from '../sessions/MemberAvatar'
import { useSessions } from '../sessions/sessionsStore'
import { useSwipeToQueue } from './useSwipeToQueue'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { useIsTouchDevice } from '@/lib/useIsTouchDevice'
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
  /** This problem is in the active session's queue — shows the blue name-line "in queue" marker. */
  isQueued?: boolean
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
  isQueued = false,
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

  // Swipe-left-to-queue (U7): active only while an active session targets THIS board. Reads the
  // sessions store directly (the useMemberSenders no-prop-drill idiom), so the gesture stays inert
  // and adds no behavior when the crew isn't in a session on this board. Touch-only: on a desktop
  // the gesture can never run (the hook binds touch listeners), so gate it on a coarse pointer.
  const { activeSession } = useSessions()
  const isTouch = useIsTouchDevice()
  const swipeEnabled =
    isTouch && !!activeSession && activeSession.boardLayoutId === board.layoutId
  const rowRef = useRef<HTMLDivElement>(null)
  const swipe = useSwipeToQueue(rowRef, {
    sourceCatalogId: problem.source_catalog_id,
    boardLayoutId: board.layoutId,
    enabled: swipeEnabled,
  })

  return (
    // Swipe reveal is a side-by-side flex track (row + action), not an action layered behind the
    // row: sliding the track left brings the action into the space the row vacates. So the row
    // needs no opaque background — it's transparent and matches whatever surface it sits on (page
    // or drawer) for free, and there's nothing behind it to seam through at the edge. The divider
    // lives on this stationary wrapper so it doesn't slide with the row.
    <div
      ref={rowRef}
      // When this row lives inside a drawer (e.g. the recents sheet), opt its swipe out of the
      // Base UI Drawer's touch handling, which otherwise claims touchmove and starves the gesture.
      // Inert in the main catalog (no drawer ancestor).
      {...(swipeEnabled ? { 'data-base-ui-swipe-ignore': '' } : {})}
      className="relative overflow-hidden border-b border-border/50"
    >
      {/* "In queue" cue: a soft-blue rail on the leading edge. Lives on the stationary wrapper (not
          the swipe track) so it stays put while the row slides, and sits in the row's left padding
          gutter so it never overlaps content. */}
      {isQueued && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1 bg-primary/60" />
      )}
      <div
        className="flex"
        style={
          swipeEnabled
            ? {
              transform: `translateX(${swipe.offset}px)`,
              transition: swipe.offset === 0 ? 'transform 0.2s ease-out' : 'none',
            }
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => onSelect?.(problem)}
          className="flex w-full shrink-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent"
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
              {/* In the session queue: the state reads from the left rail (below), not another
                  name-line glyph; this sr-only text is the screen-reader equivalent. */}
              {isQueued && <span className="sr-only">In queue</span>}
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
        {/* The queue action sits to the RIGHT of the row in the track, off-screen until the swipe
          slides the track left into it (decorative; the swipe + sonner confirmation convey it). */}
        {swipeEnabled && (
          <div
            aria-hidden
            className="flex shrink-0 items-center gap-1.5 bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" />
            Queue
          </div>
        )}
      </div>
    </div>
  )
}
