import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { BetaVideo } from './betaTypes'
import { useHistoryBackClose } from './useHistoryBackClose'

// Privacy-friendly official embed (no tracking cookie until play). `playsinline` keeps it in
// the sheet on iOS instead of taking over the screen.
function embedSrc(v: BetaVideo): string {
  return `https://www.youtube-nocookie.com/embed/${v.video_id}?autoplay=1&playsinline=1&rel=0`
}
function watchUrl(v: BetaVideo): string {
  return `https://youtu.be/${v.video_id}`
}

/**
 * Full-screen-ish player for one beta clip. States: iframe-loading placeholder → playing.
 * Embedding-disabled videos can't be detected cross-origin, so a "Watch on YouTube" out-link
 * is ALWAYS present as the guaranteed escape hatch. The Dialog itself provides the focus
 * trap + focus-return + Escape + backdrop-close; useHistoryBackClose adds the history entry
 * so the mobile back gesture closes the sheet first without popping the ?problem= drawer.
 */
export function BetaPlayerSheet({ video, onClose }: { video: BetaVideo | null; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false)
  useHistoryBackClose(video !== null, onClose, 'betaSheet')

  useEffect(() => {
    setLoaded(false) // reset the loading placeholder for each newly-opened clip
  }, [video?.video_id])

  return (
    <Dialog
      open={video !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {video && (
        <DialogContent showCloseButton className="flex max-h-[90dvh] w-[min(100vw-2rem,26rem)] max-w-none flex-col overflow-hidden p-0">
          <DialogTitle className="sr-only">Beta by {video.channel}</DialogTitle>
          {/* aspect-[9/16] is the PREFERRED portrait shape; min-h-0 + shrink let the video give
              back height when the 9:16 frame would exceed the 90dvh cap (e.g. a landscape clip
              or a short screen), so the modal never grows past the viewport. */}
          <div className="relative aspect-[9/16] w-full min-h-0 shrink bg-black">
            {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
            <iframe
              key={video.video_id}
              src={embedSrc(video)}
              title={`Beta by ${video.channel}`}
              onLoad={() => setLoaded(true)}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 size-full"
            />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 p-3">
            <span className="min-w-0 truncate text-sm text-muted-foreground">{video.channel}</span>
            <a
              href={watchUrl(video)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Watch on YouTube
            </a>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
