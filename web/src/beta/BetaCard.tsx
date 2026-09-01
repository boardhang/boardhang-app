import { useState } from 'react'
import { Clock, LayoutGrid, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BetaVideo } from './betaTypes'
import { thumb } from './betaThumb'

function fmtDur(s: number | null): string {
  if (s == null) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The one card shell every strip/grid tile shares — keep shape tweaks here so
// BetaCard and ViewAllTile can never drift apart.
const cardShell = 'relative aspect-[9/16] overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10'

/**
 * One portrait beta-clip card. Sizing comes from the host: the strip passes
 * `w-28 shrink-0 snap-start`, the grid sheet `w-full` — the card itself only owns
 * its 9:16 shape and overlay anatomy.
 */
export function BetaCard({
  video,
  onOpen,
  className,
}: {
  video: BetaVideo
  onOpen: (v: BetaVideo) => void
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  if (broken) return null // deleted/removed video → drop the card rather than show a gray box

  const providerTag = video.provider === 'instagram' ? 'IG' : 'YT'
  const dur = fmtDur(video.duration_s)
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      aria-label={`Beta by ${video.channel}${dur ? `, ${dur}` : ''}${video.isMine ? ', added by you' : ''}`}
      className={cn('group', cardShell, className)}
    >
      <img
        src={thumb(video)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      {video.isMine && (
        <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">
          Added by you
        </span>
      )}
      <Play className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 fill-white/90 text-white/90" />
      <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase leading-4 text-white/90">
        {providerTag}
      </span>
      {dur && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums text-white">
          {dur}
        </span>
      )}
      <span className="absolute inset-x-1 bottom-1 truncate pr-8 text-left text-[11px] font-medium text-white">
        {video.channel}
      </span>
    </button>
  )
}

// The strip's last slot when clips overflow its cap: the next clip's thumbnail dimmed
// under a "+N / View all" overlay, opening the grid sheet. `total` counts every clip
// (for the label); `hidden` counts the ones the capped strip doesn't show (this tile's
// clip included). A 404ing cover needs no handling — the scrim and overlay carry the
// tile on the bg-muted shell regardless.
export function ViewAllTile({
  cover,
  total,
  hidden,
  onClick,
  className,
}: {
  cover: BetaVideo
  total: number
  hidden: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View all ${total} beta videos`}
      className={cn(cardShell, className)}
    >
      <img src={thumb(cover)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      <span className="absolute inset-0 bg-black/65" />
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        <LayoutGrid className="size-5 text-white/90" />
        <span className="text-xl font-bold text-white">+{hidden}</span>
        <span className="text-[11px] font-medium text-white/80">View all</span>
      </span>
    </button>
  )
}

// A placeholder card for the user's own not-yet-approved submission — sits alongside
// the real beta cards until it's approved (then it becomes a real BetaCard and this disappears) or
// the local mark self-expires (~7 days). Same footprint as BetaCard so the strip stays even.
export function PendingCard({ className }: { className?: string }) {
  return (
    <div
      role="note"
      aria-label="Your beta is pending review"
      className={cn(
        'flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-muted/40 px-2 text-center',
        className,
      )}
    >
      <Clock className="size-6 text-muted-foreground" />
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">
        Your beta is pending review
      </span>
    </div>
  )
}
