// The global "in session" pill (U6): a slim, self-gating chrome element shown on every
// route while a collaboration session is active — EXCEPT the catalog, where the richer
// SessionBar already owns that surface (avoids two concurrent Leave/Share controls). Tapping
// it opens a panel with the roster, the shared ShareSession affordance, and a deliberate
// Leave. When the current user is the owner, each other roster row carries a remove control
// (owner-removes-member, KTD-11) — the UI consumer of the owner-only DELETE policy.

import { Users } from 'lucide-react'
import { leaveSession, removeMember, useSessions } from '../sessions/sessionsStore'
import { ShareSession } from '../sessions/ShareSession'
import { memberInitials, memberLabel } from '../sessions/sessionsTypes'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'

export function SessionPill({ suppressed }: { suppressed?: boolean }) {
  const { activeSession, roster, selfId } = useSessions()
  // Self-gating: nothing to show without an active session, and suppressed on the catalog
  // route (the SessionBar owns that surface).
  if (!activeSession || suppressed) return null

  const isOwner = !!selfId && activeSession.ownerId === selfId
  const count = roster.length || 1

  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger className="mb-2 flex w-full items-center gap-2 rounded-md border border-border bg-primary/10 px-3 py-1.5 text-sm text-foreground transition hover:bg-primary/15">
        <Users className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{activeSession.name || 'Session'}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} {count === 1 ? 'member' : 'members'}
        </span>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
          <DrawerHeader>
            <DrawerTitle>{activeSession.name || 'Session'}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            {/* Roster */}
            <ul className="space-y-1.5">
              {roster.length === 0 ? (
                <li className="text-sm text-muted-foreground">Loading members…</li>
              ) : (
                roster.map((m) => {
                  const isSelf = m.userId === selfId
                  return (
                    <li key={m.userId} className="flex items-center gap-2.5">
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[0.65rem] font-semibold text-foreground">
                        {memberInitials(m)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {isSelf ? 'You' : memberLabel(m)}
                      </span>
                      {isOwner && !isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${memberLabel(m)}`}
                          onClick={() => void removeMember(m.userId)}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  )
                })
              )}
            </ul>

            {/* Share */}
            <ShareSession />

            {/* Leave — one deliberate tap (R16) */}
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => void leaveSession()}
            >
              Leave session
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
