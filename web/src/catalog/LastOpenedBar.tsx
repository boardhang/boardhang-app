// The catalog "last opened" bar: a slim, session-only strip showing the problem you
// most recently opened for this board+angle. CatalogScreen portals it into the shell's
// bottom slot (see bottomSlot), so it sits as a real layout row directly above the nav.
// Tap the body to reopen the full drawer; ♡ favorites and 💡 lights up the holds over
// BLE inline; × dismisses until the next open. Renders nothing until a problem has been
// opened this session (useLastOpened is null on a cold load), and blanks when the board
// or angle changes (the store is keyed per slab).

import { BadgeCheck, CheckCircle2, Heart, Lightbulb, Repeat, Star, X } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { CatalogBoard } from '../board/CatalogBoard'
import type { CatalogProblem } from './catalogSync'
import { useFavorites } from './favoritesStore'
import { useLastOpened } from './lastOpenedStore'
import { useShowPreviews } from './previewsStore'
import { useLightUp } from '../ble/useLightUp'
import { Button } from '@/components/ui/button'

interface LastOpenedBarProps {
  board: CatalogBoardDef
  angle: number
  /** The full slab — resolves the shown problem (kept even when filters exclude it). */
  problems: CatalogProblem[]
  /** Catalog ids the user has a logged send for — drives the green sent check. */
  sentIds: Set<string>
  /** "col-row" positions from the active holds filter to ring on the thumbnail. */
  highlightHolds?: Set<string>
  /** Open the full drawer on a problem id (records a recent — the write path). */
  onOpen: (id: string) => void
  /** Dismiss the bar for this slab. */
  onDismiss: () => void
}

export function LastOpenedBar({
  board,
  angle,
  problems,
  sentIds,
  highlightHolds,
  onOpen,
  onDismiss,
}: LastOpenedBarProps) {
  const shownId = useLastOpened(board.layoutId, angle)
  const { favoriteIds, toggleFavorite } = useFavorites()
  const showThumbnail = useShowPreviews()

  // Resolve against the full slab so a last-opened climb the filters now exclude still
  // renders (it was opened from this slab, so it's present).
  const shown = shownId
    ? problems.find((p) => p.source_catalog_id === shownId)
    : undefined

  // Hooks must run unconditionally; a null shownId yields an inert action (never triggered).
  const light = useLightUp(board, shownId ?? '')

  if (!shown) return null

  const isFav = favoriteIds.has(shown.source_catalog_id)
  const isSent = sentIds.has(shown.source_catalog_id)
  const subtitle = shown.setter ? `by ${shown.setter}` : `${shown.holds.length} holds`

  return (
    <div className="border-t border-border bg-background px-2 py-1.5">
      <div className="flex items-center gap-1">
        {/* Body: thumbnail + identity — tap to reopen the full drawer. */}
        <button
          type="button"
          aria-label={`Open ${shown.name}`}
          onClick={() => onOpen(shown.source_catalog_id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/50 active:bg-accent"
        >
          {showThumbnail && (
            <div className="w-11 shrink-0">
              <CatalogBoard board={board} holds={shown.holds} highlightHolds={highlightHolds} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold uppercase tracking-tight">
                {shown.name}
              </span>
              {shown.is_benchmark && (
                <BadgeCheck role="img" aria-label="Benchmark" className="size-4 shrink-0 text-benchmark" />
              )}
              {isSent && (
                <CheckCircle2 role="img" aria-label="Sent" className="size-4 shrink-0 text-success" />
              )}
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
                {shown.grade}
              </span>
            </div>
            {/* Metadata row — mirrors CatalogRow: stars · repeats · method · setter. */}
            <div className="mt-0.5 flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
              {shown.stars > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <Star className="size-3" /> {shown.stars}
                </span>
              )}
              {shown.repeats > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <Repeat className="size-3" /> {shown.repeats}
                </span>
              )}
              {shown.method && <span className="shrink-0 text-foreground/70">{shown.method}</span>}
              <span className="truncate">{subtitle}</span>
            </div>
          </div>
        </button>

        {/* Controls: favorite, light up, dismiss. */}
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={isFav ? 'Unfavorite' : 'Favorite'}
            aria-pressed={isFav}
            onClick={() => toggleFavorite(shown.source_catalog_id)}
          >
            <Heart className={isFav ? 'size-4 fill-favorite text-favorite' : 'size-4'} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={light.busy ? 'Lighting up…' : light.lit ? 'Lit — send again' : 'Light up'}
            disabled={light.busy !== null}
            onClick={() => void light.lightUp(shown.holds)}
          >
            <Lightbulb className={light.lit ? 'size-4 fill-current' : 'size-4'} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
