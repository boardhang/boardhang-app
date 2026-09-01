import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '../auth/AuthProvider'
import { SignInDialog } from '../auth/SignInDialog'
import { useBetaVideos, refetchBeta } from './betaStore'
import type { BetaVideo } from './betaTypes'
import { BetaCard, PendingCard, ViewAllTile } from './BetaCard'
import { BetaGridSheet } from './BetaGridSheet'
import { BetaPlayerSheet } from './BetaPlayerSheet'
import { BetaSubmitDialog } from './BetaSubmitDialog'

// A submitted beta lands `pending` (invisible until an owner approves), so the only in-app signal
// is a local note. It self-expires after ~7 days — rejection is silent (the row is soft-deleted
// and never visible to the client), so without expiry the note would say "pending" forever.
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000

// The strip shows at most this many cards inline; the rest collapse into a "+N View all"
// tile opening the grid sheet. No tile at STRIP_CAP+1 clips — a "+1" tile would hide
// exactly the one clip it replaces.
const STRIP_CAP = 4

// One strip slot's sizing, shared by every tile kind so the strip stays even.
const STRIP_SLOT = 'w-28 shrink-0 snap-start'

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

/**
 * The "Beta videos" section at the bottom of the problem drawer: a horizontal strip of
 * portrait clip cards (views-desc), tap → player sheet. Always renders, with four states —
 * loading (skeleton cards), has-videos (the strip), empty ("No beta videos yet"), and error
 * (a distinct "Try again"). Empty/error keep their own slot so a transient failure is
 * distinguishable from a genuinely video-less problem. A user's own pending submission shows as a
 * placeholder card in the strip (PendingCard) until it's approved or the local mark expires.
 * Past STRIP_CAP clips the strip ends in a "+N View all" tile opening BetaGridSheet.
 */
export function BetaVideos({ sourceCatalogId }: { sourceCatalogId: string }) {
  const { status, videos } = useBetaVideos(sourceCatalogId)
  const { status: authStatus } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  const [active, setActive] = useState<BetaVideo | null>(null)
  const [gridOpen, setGridOpen] = useState(false)
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

  const overflow = videos.length > STRIP_CAP + 1
  const stripVideos = overflow ? videos.slice(0, STRIP_CAP) : videos

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
            <Skeleton key={i} className={`aspect-[9/16] rounded-lg ${STRIP_SLOT}`} />
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
          {pending && <PendingCard className={STRIP_SLOT} />}
          {stripVideos.map((v) => (
            <BetaCard key={v.id} video={v} onOpen={setActive} className={STRIP_SLOT} />
          ))}
          {overflow && (
            <ViewAllTile
              cover={videos[STRIP_CAP]}
              total={videos.length}
              hidden={videos.length - STRIP_CAP}
              onClick={() => setGridOpen(true)}
              className={STRIP_SLOT}
            />
          )}
        </div>
      )}

      <BetaGridSheet
        open={gridOpen}
        onOpenChange={setGridOpen}
        videos={videos}
        pending={pending !== null}
        onOpen={setActive}
        onAddBeta={() => {
          // Close the grid first: the dialogs carry no history entry (same convention as the
          // strip path), so leaving the grid open would let a back gesture pop the grid's
          // entry UNDER the open dialog and desync the visual stack from history.
          setGridOpen(false)
          addBeta()
        }}
      />
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
