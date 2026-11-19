// The first-run page, shown at /boards while no board is added: one card with one
// "Add a board" button, and the scan row for joining a friend's session. The header
// shows no board name here, because there is no board yet.

import { useNavigate } from '@tanstack/react-router'
import { SquarePlus } from 'lucide-react'
import { useSessions } from '../sessions/sessionsStore'
import { Button } from '@/components/ui/button'
import { ScanQrRow } from './ScanQrRow'

export function FirstBoard() {
  const navigate = useNavigate()
  // Joining a session is a no-session action, so the scan row hides once one is active.
  // Signed-out users still see it: the join route owns sign-in.
  const { activeSession } = useSessions()

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
        <SquarePlus className="size-8 text-muted-foreground" />
        <div>
          <h1 className="text-base font-semibold">Add your first board</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the board you climb on, its angle and its hold sets.
          </p>
        </div>
        <Button size="lg" onClick={() => void navigate({ to: '/boards/add' })}>
          Add a board
        </Button>
      </div>
      {!activeSession && <ScanQrRow />}
    </div>
  )
}
