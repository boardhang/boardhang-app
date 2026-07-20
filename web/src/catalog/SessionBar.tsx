// In-context catalog session bar (U7). Shows the active session for THIS board — its name
// (inline-renameable), member initials, Share (QR + link), and a ⋯ menu with Leave. When no
// session is active it offers "Start session" and stacks any cross-device Resume rows for
// this board above it; when a session for a DIFFERENT board is active it renders nothing
// (the global pill surfaces that one).

import { useCallback, useRef, useState } from 'react'
import { MoreHorizontal, Plus, Share2, Users, X } from 'lucide-react'
import type { CatalogBoardDef } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { QueueDrawer } from '../sessions/QueueDrawer'
import { boardShortLabel } from '../lists/listsTypes'
import { useAuth } from '../auth/AuthProvider'
import {
  createSession,
  endSession,
  leaveSession,
  removeMember,
  renameSession,
  useSessions,
} from '../sessions/sessionsStore'
import { useResumableSessions } from '../sessions/useResumableSessions'
import { ResumableSessionRow } from '../sessions/ResumableSessionRow'
import { defaultSessionName, MAX_SESSION_NAME, memberInitials, memberLabel } from '../sessions/sessionsTypes'
import { MemberAvatar } from '../sessions/MemberAvatar'
import { ShareSession } from '../sessions/ShareSession'
import { ScanToJoin } from '../sessions/ScanToJoin'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// SessionBar only ever renders under the board catalog route. The queue entry drives the shared
// ?problem drawer through the pager opener CatalogScreen hands down (`onOpenProblem`), which
// snapshots the queue as the paging domain so the detail view pages in queue order (KTD9).
export interface SessionBarProps {
  board: CatalogBoardDef
  /** Open the ?problem detail pager on `id`, paging over `stack` (the queue's order). */
  onOpenProblem: (id: string, stack: CatalogProblem[]) => void
}

export function SessionBar({ board, onOpenProblem }: SessionBarProps) {
  const { activeSession } = useSessions()
  const { status: authStatus } = useAuth()
  const signedIn = authStatus !== 'signedOut'
  const activeForThisBoard = activeSession && activeSession.boardLayoutId === board.layoutId

  // Share state lives HERE (not in StartBar) so it survives the Start→Active transition:
  // createSession flips the store to active, which swaps StartBar for ActiveBar — a
  // shareOpen owned by StartBar would unmount before the dialog could show. By the time the
  // dialog opens, the session is active, so ShareSession's getInviteToken() has a session.
  const [shareOpen, setShareOpen] = useState(false)

  // A session for another board is surfaced by the global pill, not here.
  if (activeSession && !activeForThisBoard) return null

  return (
    <>
      {activeForThisBoard ? (
        <ActiveBar board={board} onShare={() => setShareOpen(true)} onOpenProblem={onOpenProblem} />
      ) : (
        <>
          {/* In-context Resume: when a live session for THIS board exists on the server (e.g.
              started on the user's other device), stack one row per candidate above StartBar so
              the crew is discoverable right where you'd expect. Explicit tap only — the app never
              silently auto-adopts (R1 of docs/plans/2026-07-20-001-feat-web-resume-active-session-plan.md). */}
          <ResumeRows board={board} />
          <StartBar board={board} signedIn={signedIn} onStarted={() => setShareOpen(true)} />
        </>
      )}
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </>
  )
}

/** Renders 0..N slim "Resume" rows for live sessions on THIS board, plus a slim "session ended"
 *  row after a dead-on-arrival tap (auto-clears when the list repopulates). Same chrome family as
 *  StartBar/ActiveBar so the whole SessionBar reads as one stacked strip. */
function ResumeRows({ board }: { board: CatalogBoardDef }) {
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions({
    boardLayoutId: board.layoutId,
  })
  if (resumable.length === 0 && !endedNotice) return null
  return (
    <>
      {resumable.map((s) => (
        <ResumableSessionRow
          key={s.id}
          session={s}
          disabled={resumingId === s.id}
          onResume={(sess) => void onResume(sess)}
          // Merge SessionBar's slim in-bar chrome over the row's default card styling.
          className="rounded-none border-x-0 border-b border-t-0 bg-muted/60 hover:bg-muted"
        />
      ))}
      {endedNotice && resumable.length === 0 && (
        <p
          role="status"
          className="border-b border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
        >
          That session has ended.
        </p>
      )}
    </>
  )
}

function StartBar({
  board,
  signedIn,
  onStarted,
}: {
  board: CatalogBoardDef
  signedIn: boolean
  onStarted: () => void
}) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The icon button opens the scanner-first launcher: it opens on the camera to join, with
  // "Start your own session" as the demoted host path inside the same dialog.
  const [open, setOpen] = useState(false)

  const start = useCallback(async () => {
    if (starting) return // guard double-tap → no duplicate session
    setStarting(true)
    setError(null)
    try {
      await createSession(board.layoutId, defaultSessionName(boardShortLabel(board.name), new Date()))
      setOpen(false)
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start a session.')
    } finally {
      setStarting(false)
    }
  }, [starting, board, onStarted])

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Users className="size-4 shrink-0" />
        <span className="truncate">Session with friends</span>
      </span>
      <div className="flex items-center gap-2">
        {error && <span className="truncate text-xs text-destructive">{error}</span>}
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setOpen(true)}
          aria-label="Start or join a session"
          title="Start or join a session"
        >
          <Plus className="size-4" />
        </Button>

        <ScanToJoin
          open={open}
          onOpenChange={setOpen}
          onStart={() => void start()}
          starting={starting}
          canStart={signedIn}
        />
      </div>
    </div>
  )
}

function ActiveBar({
  board,
  onShare,
  onOpenProblem,
}: {
  board: CatalogBoardDef
  onShare: () => void
  onOpenProblem: (id: string, stack: CatalogProblem[]) => void
}) {
  const { activeSession, roster, selfId } = useSessions()
  const [menuOpen, setMenuOpen] = useState(false)
  const isOwner = !!selfId && activeSession?.ownerId === selfId
  const removable = roster.filter((m) => m.userId !== selfId)

  if (!activeSession) return null
  const shown = roster.slice(0, 6)
  const extra = roster.length - shown.length
  // Solo session: no one else to leave behind, so collapse to a single "End session".
  // Require exactly one member so a not-yet-loaded roster (length 0) keeps the full menu.
  const alone = roster.length === 1

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <SessionName board={board} name={activeSession.name} />

      {/* shadcn AvatarGroup: overlaps the avatars and applies the ring-2 ring-background
          separation to each; AvatarGroupCount is the "+N" overflow pill. */}
      <AvatarGroup aria-label={`${roster.length || 'loading'} members`}>
        {shown.length === 0
          ? // Roster still loading — neutral placeholder dots (never raw user-ids).
            [0, 1].map((i) => (
              <span key={i} className="size-6 rounded-full ring-2 ring-background bg-muted-foreground/20" />
            ))
          : shown.map((m) => (
              <MemberAvatar
                key={m.userId}
                initials={memberInitials(m)}
                avatarUrl={m.avatarUrl}
                title={m.displayName ?? m.handle ?? undefined}
              />
            ))}
        {extra > 0 && <AvatarGroupCount className="text-[0.6rem]">+{extra}</AvatarGroupCount>}
      </AvatarGroup>

      <div className="ml-auto flex items-center gap-1">
        <QueueDrawer board={board} compact onOpenProblem={onOpenProblem} />
        <Button variant="ghost" size="icon" className="size-8" onClick={onShare} aria-label="Share session">
          <Share2 className="size-4" />
        </Button>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" className="size-8" aria-label="Session options" />}
          >
            <MoreHorizontal className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            {/* Owner-removes-member (KTD-11) — the UI consumer of the owner-only DELETE policy. */}
            {isOwner && removable.length > 0 && (
              <>
                <p className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">Remove a member</p>
                {removable.map((m) => (
                  <Button
                    key={m.userId}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    aria-label={`Remove ${memberLabel(m)}`}
                    onClick={() => void removeMember(m.userId)}
                  >
                    <MemberAvatar initials={memberInitials(m)} avatarUrl={m.avatarUrl} />
                    <span className="min-w-0 flex-1 truncate text-left">{memberLabel(m)}</span>
                    <X className="size-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                ))}
                <div className="my-1 h-px bg-border" />
              </>
            )}
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  void endSession()
                }}
              >
                {alone ? 'End session' : 'End session for everyone'}
              </Button>
            )}
            {!(isOwner && alone) && (
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
            )}
          </PopoverContent>
        </Popover>
      </div>
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
