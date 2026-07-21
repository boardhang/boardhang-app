// One logged-ascent row in the logbook. Shows the ascent's own data (name, grade pill
// + grade-vote arrow, stars, tries, sent/attempt, comment) enriched — where the catalog
// entry is cached — with setter, benchmark flag and a board thumbnail. Mirrors iOS
// `AscentRow`.
//
// When `onSelect` is provided (the row's catalog entry resolved), the whole content area
// is a button that opens the problem detail drawer; the pencil (a sibling button) opens
// the edit sheet. Rows whose problem can't be resolved (user-created or uncached) get no
// `onSelect` and render the content as a plain div — not tappable, edit still reachable.

import { ArrowDown, ArrowUp, BadgeCheck, CheckCircle2, Pencil, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import { gradeIndex } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import { Button } from '@/components/ui/button'
import type { Ascent } from './ascents'
import { triesLabel } from './tryBucket'

interface AscentRowProps {
  ascent: Ascent
  /** Cached catalog entry for setter/benchmark/thumbnail; absent → graceful fallback. */
  catalog?: CatalogProblem
  /** Board for the thumbnail; only needed when `showThumbnail`. */
  board?: CatalogBoardDef
  showThumbnail?: boolean
  /** Show the green "Sent" check / "Attempt" pill. Default true (logbook). A profile lists only
   *  that user's sends, so the check would be always-on and read as "you sent it" — pass false. */
  showSentIndicator?: boolean
  /** Edit this ascent (the pencil). Omitted on read-only surfaces (e.g. another user's
   *  profile) — the pencil then isn't rendered. */
  onEdit?: (ascent: Ascent) => void
  /** Open this ascent's problem detail. Omitted when the problem can't be resolved
   *  (user-created or uncached) — the content area then renders as a non-interactive div. */
  onSelect?: () => void
}

/** +1 harder / -1 softer / 0 same, comparing voted vs official grade. */
function voteDirection(votedGrade: string, problemGrade: string): number {
  const voted = gradeIndex(votedGrade)
  const official = gradeIndex(problemGrade)
  if (voted > official) return 1
  if (voted < official) return -1
  return 0
}

export function AscentRow({
  ascent,
  catalog,
  board,
  showThumbnail = false,
  showSentIndicator = true,
  onEdit,
  onSelect,
}: AscentRowProps) {
  const setter = catalog?.setter
  const holds = catalog?.holds
  const direction = ascent.sent ? voteDirection(ascent.votedGrade, ascent.problemGrade) : 0

  // The tappable content: thumbnail + name/meta/comment + grade pill. Rendered inside a
  // button when the row opens detail, else a plain div (see onSelect doc above).
  const content: ReactNode = (
    <>
      {showThumbnail && holds && board && (
        <div className="w-[64px] shrink-0">
          <CatalogBoard board={board} holds={holds} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold uppercase tracking-tight">
            {ascent.problemName}
          </span>
          {catalog?.is_benchmark && (
            <BadgeCheck role="img" aria-label="Benchmark" className="size-4 shrink-0 text-benchmark" />
          )}
          {showSentIndicator &&
            (ascent.sent ? (
              <CheckCircle2 role="img" aria-label="Sent" className="size-4 shrink-0 text-success" />
            ) : (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                Attempt
              </span>
            ))}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {ascent.stars > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Star className="size-3" /> {ascent.stars}
            </span>
          )}
          {Number.isFinite(ascent.tries) && (
            <span className="shrink-0">{triesLabel(ascent.tries, ascent.sent)}</span>
          )}
          {setter && <span className="truncate">by {setter}</span>}
        </div>
        {ascent.comment && (
          <p className="mt-0.5 line-clamp-2 text-xs text-foreground/70">{ascent.comment}</p>
        )}
      </div>

      {/* Grade pill + vote arrow (arrow only when the vote differs from the grade). */}
      <div className="flex shrink-0 items-center gap-1">
        {direction !== 0 && (
          <span
            className={`inline-flex items-center rounded px-1 py-0.5 text-[0.7rem] font-semibold tabular-nums ${
              direction > 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
            }`}
          >
            {direction > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {ascent.votedGrade}
          </span>
        )}
        <span className="rounded-md bg-secondary px-2 py-1 text-sm font-bold tabular-nums text-secondary-foreground">
          {ascent.problemGrade}
        </span>
      </div>
    </>
  )

  return (
    <div className="flex items-center border-b border-border/50">
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Open ${ascent.problemName}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">{content}</div>
      )}

      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit log for ${ascent.problemName}`}
          onClick={() => onEdit(ascent)}
          className="mr-1 shrink-0"
        >
          <Pencil className="size-4" />
        </Button>
      )}
    </div>
  )
}
