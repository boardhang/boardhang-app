// Join-by-link route (/session/join/$token). Signs the user in if needed, shows the
// honest-visibility consent notice (R8/R9), joins via the join_session_by_token RPC (U2),
// and lands them in the session's board catalog with the session active (R15).
//
// Sign-in resume: the app's surfaced sign-in is the on-page email code, so a successful
// sign-in re-renders this route straight into consent. For an OAuth round-trip that would
// drop this route (return to `/`), the token is persisted to localStorage and AppLayout
// resumes back here once a session lands — otherwise the invitee would never complete R15.

import { useEffect, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { boardByLayoutId } from '../board/boards'
import { catalogNavTarget } from '../catalog/catalogNav'
import { useAuth } from '../auth/AuthProvider'
import { SignInPanel } from '../auth/SignInPanel'
import { joinSession } from './sessionsStore'
import { Button } from '@/components/ui/button'

const routeApi = getRouteApi('/session/join/$token')

/** localStorage key for an in-flight join token — survives an OAuth redirect that drops this
 *  route (AppLayout resumes it). Exported so AppLayout reads the same key. */
export const PENDING_JOIN_KEY = 'pendingJoinToken'

export function JoinSession() {
  const { token } = routeApi.useParams()
  const navigate = useNavigate()
  const { status, isRestoring } = useAuth()
  const signedIn = status !== 'signedOut'
  const [phase, setPhase] = useState<'consent' | 'joining' | 'error'>('consent')
  const [error, setError] = useState<string | null>(null)

  // Persist the token while signed out (survive an OAuth round-trip); clear it once we're
  // here signed in and no longer need the resume.
  useEffect(() => {
    try {
      if (signedIn) localStorage.removeItem(PENDING_JOIN_KEY)
      else localStorage.setItem(PENDING_JOIN_KEY, token)
    } catch {
      /* private mode — resume just won't fire; the on-page email flow still works */
    }
  }, [signedIn, token])

  const accept = async () => {
    setPhase('joining')
    setError(null)
    try {
      const session = await joinSession(token)
      const board = boardByLayoutId(session.boardLayoutId)
      if (board) void navigate(catalogNavTarget(board))
      else void navigate({ to: '/boards' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That session link is no longer valid.')
      setPhase('error')
    }
  }

  const leave = () => void navigate({ to: '/boards' })

  if (isRestoring) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold">Join the session</h1>
          <p className="text-sm text-muted-foreground">Sign in to join your friends’ session.</p>
        </div>
        <SignInPanel />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-10 text-center">
        <h1 className="text-lg font-semibold">Session unavailable</h1>
        <p className="text-sm text-muted-foreground">
          {error ?? 'This session has expired or could not be found.'}
        </p>
        <Button onClick={leave}>Go to my boards</Button>
      </div>
    )
  }

  if (phase === 'joining') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Joining…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 py-8">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">Join this session</h1>
      </div>
      <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
        While you’re in this session, the other members can see which problems you’ve{' '}
        <strong className="text-foreground">sent or tried</strong> on this board. Your comments,
        dates, and number of attempts stay private.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={leave}>
          Not now
        </Button>
        <Button className="flex-1" onClick={() => void accept()}>
          Join session
        </Button>
      </div>
    </div>
  )
}
