// In-context catalog session bar (U7). Shows the active session for THIS board — its name
// (inline-renameable), member initials, a manual refresh, Share (QR + link), and a ⋯ menu
// with Leave. When no session is active it offers "Start session"; when a session for a
// DIFFERENT board is active it renders nothing (the global pill surfaces that one).

import { useCallback, useRef, useState } from 'react'
import { MoreHorizontal, RefreshCw, Share2, Users } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import { boardShortLabel } from '../lists/listsTypes'
import { useAuth } from '../auth/AuthProvider'
import {
  createSession,
  leaveSession,
  refreshActiveSession,
  renameSession,
  useSessions,
} from '../sessions/sessionsStore'
import { refreshMemberAscents } from '../sessions/memberAscentsStore'
import { defaultSessionName, MAX_SESSION_NAME, memberInitials } from '../sessions/sessionsTypes'
import { ShareSession } from '../sessions/ShareSession'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export function SessionBar({ board }: { board: CatalogBoardDef }) {
  const { activeSession } = useSessions()
  const { status: authStatus } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  const activeForThisBoard = activeSession && activeSession.boardLayoutId === board.layoutId

  if (activeForThisBoard) return <ActiveBar board={board} />
  // A session for another board is surfaced by the global pill, not here.
  if (activeSession) return null
  return <StartBar board={board} signedIn={signedIn} />
}

function StartBar({ board, signedIn }: { board: CatalogBoardDef; signedIn: boolean }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const start = useCallback(async () => {
    if (starting) return // guard double-tap → no duplicate session
    setStarting(true)
    setError(null)
    try {
      await createSession(board.layoutId, defaultSessionName(boardShortLabel(board.name), new Date()))
      setShareOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start a session.')
    } finally {
      setStarting(false)
    }
  }, [starting, board])

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Users className="size-4 shrink-0" />
        <span className="truncate">Filter with friends</span>
      </span>
      <div className="flex items-center gap-2">
        {error && <span className="truncate text-xs text-destructive">{error}</span>}
        <Button
          size="sm"
          disabled={!signedIn || starting}
          title={signedIn ? undefined : 'Sign in to start a session'}
          onClick={() => void start()}
        >
          {starting ? 'Starting…' : 'Start session'}
        </Button>
      </div>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  )
}

function ActiveBar({ board }: { board: CatalogBoardDef }) {
  const { activeSession, roster } = useSessions()
  const [shareOpen, setShareOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([refreshMemberAscents(), refreshActiveSession({ manual: true })])
    } finally {
      setRefreshing(false)
    }
  }, [])

  if (!activeSession) return null
  const shown = roster.slice(0, 6)
  const extra = roster.length - shown.length

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <SessionName board={board} name={activeSession.name} />

      <div className="flex -space-x-1.5" aria-label={`${roster.length || 'loading'} members`}>
        {shown.length === 0
          ? // Roster still loading — neutral placeholder dots (never raw user-ids).
            [0, 1].map((i) => (
              <span key={i} className="size-6 rounded-full border border-background bg-muted-foreground/20" />
            ))
          : shown.map((m) => (
              <span
                key={m.userId}
                title={m.displayName ?? m.handle ?? undefined}
                className="flex size-6 items-center justify-center rounded-full border border-background bg-primary/15 text-[0.6rem] font-semibold text-foreground"
              >
                {memberInitials(m)}
              </span>
            ))}
        {extra > 0 && (
          <span className="flex size-6 items-center justify-center rounded-full border border-background bg-muted text-[0.6rem] font-medium text-muted-foreground">
            +{extra}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => void refresh()} aria-label="Refresh members">
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setShareOpen(true)} aria-label="Share session">
          <Share2 className="size-4" />
        </Button>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" className="size-8" aria-label="Session options" />}
          >
            <MoreHorizontal className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                setMenuOpen(false)
                void leaveSession()
              }}
            >
              Leave session
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  )
}

/** Inline-renameable session name (R18): click to edit, commit on blur/Enter, cancel on
 *  Escape, hard-capped at 60 chars, empty falls back to the auto-default. */
function SessionName({ board, name }: { board: CatalogBoardDef; name: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    const next = draft.trim() ? draft : defaultSessionName(boardShortLabel(board.name), new Date())
    void renameSession(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        maxLength={MAX_SESSION_NAME}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
        className="h-7 w-40 text-sm"
        aria-label="Session name"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      className="min-w-0 max-w-[9rem] truncate text-left font-medium hover:underline"
      title="Rename session"
    >
      {name || 'Session'}
    </button>
  )
}

function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite to this session</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Anyone who joins shares which problems they’ve <strong>sent or tried</strong> on this board.
        </p>
        <ShareSession />
      </DialogContent>
    </Dialog>
  )
}
