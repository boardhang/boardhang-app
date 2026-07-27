// Leaving a session IS the revocation (docs/collaboration-sessions.md), so a failed one must
// never be silent. The store queues the unfinished write (`sessionsPendingExit`) and retries it;
// these wrappers are the user-facing half — they retire the session on this device and say what
// is still true on the server. Shared by every deliberate Leave/End affordance (SessionBar,
// SessionPill) so the surfaces can't drift; board removal has its own handler because it also
// owns the leave-vs-end decision and names the board.

import { toast } from 'sonner'
import { endActiveSessionLocally, endSession, leaveSession } from './sessionsStore'

/** Copy for a leave that never reached the server — the membership row (and the status sharing
 *  it carries) survives until the queued retry lands or the session expires. */
export const LEAVE_PENDING_NOTE =
  'The others may still see you until we finish this next time you’re online.'

/** Copy for an end that never reached the server — the session is still live AND still joinable
 *  by anyone holding the invite link, which is a sharper thing to say than "may still see you". */
export const END_PENDING_NOTE =
  'It’s still running and its invite link still works — we’ll finish ending it next time you’re online.'

export async function leaveSessionWithFeedback(): Promise<void> {
  try {
    await leaveSession()
  } catch (e) {
    console.error('Could not leave the session', e)
    endActiveSessionLocally()
    toast('Left the session on this device', { description: LEAVE_PENDING_NOTE })
  }
}

export async function endSessionWithFeedback(): Promise<void> {
  try {
    await endSession()
  } catch (e) {
    console.error('Could not end the session', e)
    endActiveSessionLocally()
    toast('Couldn’t end the session yet', { description: END_PENDING_NOTE })
  }
}
