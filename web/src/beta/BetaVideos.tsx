import { useEffect, useState } from 'react'
import { Clock, Play, Plus } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import { useBetaVideos, refetchBeta } from './betaStore'
import type { BetaVideo } from './betaTypes'
import { BetaPlayerSheet } from './BetaPlayerSheet'
import { BetaSubmitDialog } from './BetaSubmitDialog'

// A submitted beta lands `pending` (invisible until an owner approves), so the only in-app signal
// is a local note. It self-expires after ~7 days — rejection is silent (the row is soft-deleted
// and never visible to the client), so without expiry the note would say "pending" forever.
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface PendingMark {
  videoId: string
  ts: number
}

function pendingKey(id: string): string {
  return `beta-pending:${id}`
}

function readPending(id: string): PendingMark | null {
  try {
    const raw = localStorage.getItem(pendingKey(id))
    if (!raw) return null
    const mark = JSON.parse(raw) as PendingMark
    if (typeof mark?.ts !== 'number' || Date.now() - mark.ts > PENDING_TTL_MS) {
      localStorage.removeItem(pendingKey(id))
      return null
    }
    return mark
  } catch {
    return null
  }
}

function writePending(id: string, videoId: string): void {
  try {
    localStorage.setItem(pendingKey(id), JSON.stringify({ videoId, ts: Date.now() }))
  } catch {
    // localStorage unavailable (private mode) — the note is best-effort
  }
}

function clearPending(id: string): void {
  try {
    localStorage.removeItem(pendingKey(id))
  } catch {
    // ignore
  }
}

function fmtDur(s: number | null): string {
  if (s == null) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// hqdefault is a 480×360 LANDSCAPE frame (Shorts are pillarboxed) — object-cover crops it to
// the portrait card. There is no reliable static portrait thumbnail for a Short.
function thumb(v: BetaVideo): string {
  return `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`
}

function BetaCard({ video, onOpen }: { video: BetaVideo; onOpen: (v: BetaVideo) => void }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null // deleted/removed video → drop the card rather than show a gray box

  const providerTag = video.provider === 'instagram' ? 'IG' : 'YT'
  const dur = fmtDur(video.duration_s)
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      aria-label={`Beta by ${video.channel}${dur ? `, ${dur}` : ''}`}
      className="group relative aspect-[9/16] w-28 shrink-0 snap-start overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10"
    >
      <img
        src={thumb(video)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
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

// A placeholder card in the strip for the user's own not-yet-approved submission — sits alongside
// the real beta cards until it's approved (then it becomes a real BetaCard and this disappears) or
// the local mark self-expires (~7 days). Same footprint as BetaCard so the strip stays even.
function PendingCard() {
  return (
    <div
      role="note"
      aria-label="Your beta is pending review"
      className="flex aspect-[9/16] w-28 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/25 bg-muted/40 px-2 text-center"
    >
      <Clock className="size-6 text-muted-foreground" />
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">
        Your beta is pending review
      </span>
    </div>
  )
}

/**
 * The "Beta videos" section at the bottom of the problem drawer: a horizontal strip of
 * portrait clip cards (views-desc), tap → player sheet. Always renders, with four states —
 * loading (skeleton cards), has-videos (the strip), empty ("No beta videos yet"), and error
 * (a distinct "Try again"). Empty/error keep their own slot so a transient failure is
 * distinguishable from a genuinely video-less problem. A user's own pending submission shows as a
 * placeholder card in the strip (PendingCard) until it's approved or the local mark expires.
 */
export function BetaVideos({ sourceCatalogId }: { sourceCatalogId: string }) {
  const { status, videos } = useBetaVideos(sourceCatalogId)
  const { status: authStatus } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  const [active, setActive] = useState<BetaVideo | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  // KTD3 resume: a signed-out "＋ Add a beta" tap remembers the intent so the submit drawer
  // reopens once sign-in lands (SignInDialog auto-closes itself on success).
  const [resume, setResume] = useState(false)
  const [pending, setPending] = useState<PendingMark | null>(null)

  // Re-read the local pending-review mark whenever the problem changes — this component persists
  // across problems in the drawer, so a useState initializer wouldn't re-run.
  useEffect(() => {
    setPending(readPending(sourceCatalogId))
  }, [sourceCatalogId])

  // Clear the note the moment the submitted clip shows up approved (it's now a real card).
  useEffect(() => {
    if (pending && videos.some((v) => v.video_id === pending.videoId)) {
      clearPending(sourceCatalogId)
      setPending(null)
    }
  }, [videos, pending, sourceCatalogId])

  // Resume the submit drawer once a signed-out tap completes sign-in.
  useEffect(() => {
    if (signedIn && resume) {
      setResume(false)
      setSubmitOpen(true)
    }
  }, [signedIn, resume])

  function addBeta() {
    if (!signedIn) {
      setResume(true)
      setSignInOpen(true)
      return
    }
    setSubmitOpen(true)
  }

  return (
    <section aria-label="Beta videos" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beta videos</h2>
        <Button variant="ghost" size="sm" className="-mr-2 h-7 gap-1 px-2 text-xs" onClick={addBeta}>
          <Plus className="size-3.5" />
          Add a beta
        </Button>
      </div>

      {status === 'loading' && (
        <div className="flex gap-3 overflow-hidden" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[9/16] w-28 shrink-0 rounded-lg" />
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-3 py-1 text-sm text-muted-foreground">
          <span>Couldn’t load beta videos.</span>
          <Button variant="outline" size="sm" onClick={() => refetchBeta(sourceCatalogId)}>
            Try again
          </Button>
        </div>
      )}

      {status === 'ready' && videos.length === 0 && !pending && (
        <p className="py-1 text-sm text-muted-foreground">No beta videos yet.</p>
      )}

      {status === 'ready' && (videos.length > 0 || pending) && (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
          {pending && <PendingCard />}
          {videos.map((v) => (
            <BetaCard key={v.id} video={v} onOpen={setActive} />
          ))}
        </div>
      )}

      <BetaPlayerSheet video={active} onClose={() => setActive(null)} />
      <SignInDialog
        open={signInOpen}
        onOpenChange={(o) => {
          setSignInOpen(o)
          // Dismissed WITHOUT a successful sign-in → drop the pending resume so a later,
          // unrelated sign-in never auto-opens the submit drawer on this problem.
          if (!o && !signedIn) setResume(false)
        }}
        title="Sign in to add a beta"
      />
      <BetaSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        sourceCatalogId={sourceCatalogId}
        onSubmitted={(videoId) => {
          writePending(sourceCatalogId, videoId)
          setPending({ videoId, ts: Date.now() })
        }}
      />
    </section>
  )
}
