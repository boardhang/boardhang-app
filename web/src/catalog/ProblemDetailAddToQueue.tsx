// The "Add to queue" action shown in the problem detail (U6 — the primary add entry
// point for the Session Playlist Queue, R2/F1). It is visible ONLY while there is an
// active collaboration session bound to the board being viewed; otherwise it renders
// nothing (an off-board or session-less detail view has no queue to add to). Mounted inside
// a fixed-width cell of ProblemDetail's segmented action toolbar, whose wrapper strips the
// button's own rounding/border so it flushes with its neighbor cells.
//
// Two-part so the queue hook is never driven with a null session (which would clear the
// shared queue store out from under the drawer): the outer gate reads the active session
// and only mounts the inner button — which unconditionally subscribes to that session's
// queue — when a same-board session exists.

import { useState } from 'react'
import { ListVideo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSessions } from '../sessions/sessionsStore'
import { addProblem, removeItem, useSessionQueue } from '../sessions/queueStore'
import { QUEUE_WRITE_ERROR, queueToast, queueToastError } from '../sessions/queueToast'

interface ProblemDetailAddToQueueProps {
  /** The catalog problem shown in the detail view. */
  sourceCatalogId: string
  /** The board the detail view is rendering — must match the session's board to add. */
  boardLayoutId: number
}

export function ProblemDetailAddToQueue({
  sourceCatalogId,
  boardLayoutId,
}: ProblemDetailAddToQueueProps) {
  const { activeSession } = useSessions()
  // Gate: only offer the action for an active session on the board being viewed.
  if (!activeSession || activeSession.boardLayoutId !== boardLayoutId) return null
  return (
    <AddToQueueButton
      sessionId={activeSession.id}
      sourceCatalogId={sourceCatalogId}
      boardLayoutId={boardLayoutId}
    />
  )
}

interface AddToQueueButtonProps {
  sessionId: string
  sourceCatalogId: string
  boardLayoutId: number
}

function AddToQueueButton({ sessionId, sourceCatalogId, boardLayoutId }: AddToQueueButtonProps) {
  const { activeItems } = useSessionQueue(sessionId)
  const [busy, setBusy] = useState(false)
  // Already in the active queue → the button toggles to "remove" (tap again to take it out).
  const queuedItem = activeItems.find((i) => i.sourceCatalogId === sourceCatalogId)

  async function onAdd() {
    if (busy) return
    setBusy(true)
    try {
      const result = await addProblem(sourceCatalogId, boardLayoutId)
      if (result === 'already-active') queueToast('Already in the queue')
    } catch (e) {
      queueToastError(e instanceof Error ? e.message : 'Couldn’t add to the queue.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (busy || !queuedItem) return
    const item = queuedItem
    setBusy(true)
    try {
      // No success toast: the icon toggles back to "add" and the row's queue rail clears, so the
      // removal is already visible — only a failure needs surfacing.
      await removeItem(item.id)
    } catch {
      queueToastError(QUEUE_WRITE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  if (queuedItem) {
    // Already queued: keep the same list icon (not a checkmark), tinted blue to read as "in queue".
    // Tapping toggles it back out of the queue.
    return (
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Remove from queue"
        disabled={busy}
        onClick={() => void onRemove()}
      >
        <ListVideo className="size-5 text-primary" />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Add to queue"
      disabled={busy}
      onClick={() => void onAdd()}
    >
      <ListVideo className="size-5" />
    </Button>
  )
}
