// The relationship button on a profile — the visible half of the follow state machine (R18).
// Its label reflects the viewer's edge; tapping it drives the transition:
//   • none    → "Follow"     → follow()
//   • pending → "Requested"  → tap CANCELS the request (unfollow, no confirm — it's cheap)
//   • active  → "Following"  → tap opens a confirm, then unfollow()
// Block is NOT here — it's a confirm-gated overflow on the ProfileScreen header.
//
// Failures are surfaced loudly (KTD10): actions are online-only, so an offline/cloud error
// toasts rather than silently reverting. The store already rolled the optimistic state back.

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { follow, unfollow, useEdge } from './followStore'
import type { ProfileCard } from './socialTypes'

function failMessage(e: unknown, fallback: string): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return "You're offline — this needs a connection."
  }
  return e instanceof Error && e.message ? e.message : fallback
}

export function RelationshipButton({ target }: { target: ProfileCard }) {
  const edge = useEdge(target.id)
  const [busy, setBusy] = useState(false)
  const [confirmUnfollow, setConfirmUnfollow] = useState(false)

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(failMessage(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (edge.status === 'none') {
    return (
      <Button
        disabled={busy}
        onClick={() => void run(() => follow(target.id, target.isPrivate), "Couldn't follow.")}
      >
        Follow
      </Button>
    )
  }

  if (edge.status === 'pending') {
    // Tapping a pending request cancels it (follower-side delete). No confirm — low stakes.
    return (
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void run(() => unfollow(target.id), "Couldn't cancel the request.")}
      >
        Requested
      </Button>
    )
  }

  // active — "Following"; tapping asks to confirm before unfollowing.
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => setConfirmUnfollow(true)}>
        Following
      </Button>
      <Dialog open={confirmUnfollow} onOpenChange={setConfirmUnfollow}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unfollow @{target.handle}?</DialogTitle>
            <DialogDescription>
              You'll stop seeing their climbs in your feed.
              {target.isPrivate && ' To follow again, you’ll need to send a new request.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmUnfollow(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(() => unfollow(target.id), "Couldn't unfollow.").then(() =>
                  setConfirmUnfollow(false),
                )
              }
            >
              Unfollow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
