// "My Boards": the boards the user owns. Each board is a clean row (name +
// config summary). The active board shows a primary "Browse" action into its
// catalog; every other owned board shows a secondary "Set as active" that just
// switches the active board (staying on this list). Tapping the config button
// opens a bottom drawer to edit angle and installed hold sets (or remove it) —
// mirroring iOS, where board config lives behind a separate sheet. Also the
// first-run surface (zero added boards).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ScanQrCode, Settings2 } from 'lucide-react'
import { BOARDS, boardByLayoutId, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { activeCsv, holdSetContext } from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import { useAuth } from '../auth/AuthProvider'
import { listMyLiveSessions, resumeSession, useSessions } from '../sessions/sessionsStore'
import { navigateToSessionBoard } from '../sessions/sessionNav'
import type { Session } from '../sessions/sessionsTypes'
import { ScanToJoinButton } from '../sessions/ScanToJoin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

interface MyBoardsProps {
  /** Jump to the catalog after activating a board (given its layout id). */
  onActivated: (layoutId: number) => void
}

export function MyBoards({ onActivated }: MyBoardsProps) {
  const { addedBoards, activeBoard, addBoard, removeBoard, activateBoard, setAngle, setActiveHoldSetsRaw } =
    useBoardStore()
  // Joining a session is a no-session action, so hide the scan affordance once one is active
  // (mirrors the catalog StartBar/ActiveBar swap). Signed-out users still see it — the join
  // route owns sign-in.
  const { activeSession } = useSessions()
  const navigate = useNavigate()
  const { status } = useAuth()
  const signedIn = status !== 'signedOut'

  // Cross-device resume: when signed in with no active session on THIS device, list the user's
  // live sessions so they can re-adopt one created/joined elsewhere (the active-session pointer is
  // otherwise device-local). On-demand pull — no realtime — that self-heals on foreground +
  // reconnect, so a fetch that failed offline recovers without a remount. Renders nothing while
  // in flight / empty / signed-out (R5); never persisted.
  const [resumable, setResumable] = useState<Session[]>([])
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [endedNotice, setEndedNotice] = useState(false)
  // Mirror `resumable` so `load` can skip a no-op empty→empty dispatch entirely (not just bail on
  // re-render) — an idle fetch that finds nothing must not touch state at all.
  const resumableRef = useRef<Session[]>([])
  const setResumableList = (next: Session[]) => {
    resumableRef.current = next
    setResumable(next)
    // A repopulated list supersedes a stale "ended" notice — otherwise a later refetch that
    // re-empties the list could resurface the notice for a session the user never tapped.
    if (next.length > 0) setEndedNotice(false)
  }

  useEffect(() => {
    if (!signedIn || activeSession) {
      if (resumableRef.current.length > 0) setResumableList([])
      return
    }
    let alive = true
    const load = async () => {
      const list = await listMyLiveSessions()
      if (!alive) return
      if (list.length === 0 && resumableRef.current.length === 0) return // idle: no state change
      setResumableList(list)
    }
    void load()
    const refetch = () => void load()
    document.addEventListener('visibilitychange', refetch)
    window.addEventListener('online', refetch)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', refetch)
      window.removeEventListener('online', refetch)
    }
  }, [signedIn, activeSession])

  // Adopt a listed session; navigate only when the reconcile confirms it is still live. A
  // dead-on-arrival session (ended/expired between list and tap) drops its row and shows a notice
  // instead of bouncing the user out of a catalog we'd otherwise have entered.
  const onResume = async (s: Session) => {
    setEndedNotice(false)
    setResumingId(s.id)
    const { live } = await resumeSession(s)
    if (live) {
      navigateToSessionBoard(navigate, s)
    } else {
      setResumableList(resumableRef.current.filter((x) => x.id !== s.id))
      setEndedNotice(true)
      setResumingId(null)
    }
  }

  const addedIds = new Set(addedBoards.map((b) => b.layoutId))
  const addable = BOARDS.filter((b) => !addedIds.has(b.layoutId))

  // Freeze the row order for this mount. "Set as active" promotes the board to
  // the MRU front in the store, but the list must not reshuffle under the user's
  // finger — only the Active badge / Browse button swap in place. A fresh mount
  // re-reads the MRU order (active board on top). Boards added this session
  // append; removed ones drop out — membership stays live, only order is frozen.
  // Seeded empty; the append loop below fills it in MRU order on first render.
  const orderRef = useRef<number[]>([])
  const byId = new Map(addedBoards.map((b) => [b.layoutId, b] as const))
  const orderedBoards: CatalogBoardDef[] = []
  for (const id of orderRef.current) {
    const b = byId.get(id)
    if (b) {
      orderedBoards.push(b)
      byId.delete(id)
    }
  }
  for (const b of addedBoards) if (byId.has(b.layoutId)) orderedBoards.push(b) // newly added this session
  orderRef.current = orderedBoards.map((b) => b.layoutId)

  return (
    <div className="space-y-4">
      {!activeSession && resumable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resume session
          </h2>
          {resumable.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={resumingId === s.id}
              onClick={() => void onResume(s)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition hover:bg-accent disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.name || 'Session'}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {boardByLayoutId(s.boardLayoutId)?.name ?? 'Session'}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">
                {resumingId === s.id ? 'Resuming…' : 'Resume'}
              </span>
            </button>
          ))}
        </section>
      )}
      {!activeSession && endedNotice && resumable.length === 0 && (
        <p
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          That session has ended.
        </p>
      )}
      {!activeSession && (
        <ScanToJoinButton variant="outline" className="w-full">
          <ScanQrCode className="size-4" />
          Join a session
        </ScanToJoinButton>
      )}
      {addedBoards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Add your first board</p>
          <p className="text-sm">Pick the MoonBoard you have to start browsing its problems.</p>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My boards
          </h2>
          {orderedBoards.map((board) => (
            <BoardCard
              key={board.layoutId}
              board={board}
              active={board.layoutId === activeBoard.layoutId}
              // Active board → browse its catalog (already active, no switch).
              onBrowse={() => onActivated(board.layoutId)}
              // Inactive board → just switch the active board; stay on this list.
              onSetActive={() => activateBoard(board.layoutId)}
              onRemove={() => removeBoard(board.layoutId)}
              onAngle={(angle) => setAngle(board.layoutId, angle)}
              onHoldSets={(csv) => setActiveHoldSetsRaw(board.layoutId, csv)}
            />
          ))}
        </section>
      )}

      {addable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add a board
          </h2>
          {addable.map((board) => (
            <div key={board.layoutId} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-sm">{board.name}</span>
              <Button size="sm" variant="outline" onClick={() => addBoard(board.layoutId)}>
                Add
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

interface BoardCardProps {
  board: CatalogBoardDef
  active: boolean
  onBrowse: () => void
  onSetActive: () => void
  onRemove: () => void
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
}

function BoardCard({ board, active, onBrowse, onSetActive, onRemove, onAngle, onHoldSets }: BoardCardProps) {
  const angle = getAngle(board)
  const { filterable, active: installed } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(board.layoutId),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const subtitle = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')

  return (
    <Card className={cn('py-3', active ? 'border-primary/60 bg-primary/5' : 'bg-transparent')}>
      <CardContent className="flex items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{board.name}</span>
            {active && (
              <Badge className="shrink-0 bg-accent text-accent-foreground">Active</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {active ? (
          <Button size="sm" onClick={onBrowse}>
            Browse
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onSetActive}>
            Set as active
          </Button>
        )}
        <BoardConfigDrawer
          board={board}
          angle={angle}
          onAngle={onAngle}
          onHoldSets={onHoldSets}
          onRemove={onRemove}
        />
      </CardContent>
    </Card>
  )
}

interface BoardConfigDrawerProps {
  board: CatalogBoardDef
  angle: number
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
  onRemove: () => void
}

function BoardConfigDrawer({ board, angle, onAngle, onHoldSets, onRemove }: BoardConfigDrawerProps) {
  const { membership, filterable, active: installed, visible } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(board.layoutId),
  )
  const [confirmRemove, setConfirmRemove] = useState(false)
  const setName = (id: number) => membership.sets.find((s) => s.id === id)?.name ?? `Set ${id}`

  function toggleSet(id: number) {
    const next = new Set(installed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size === 0) return // empty = "all"; keep at least one
    onHoldSets(activeCsv(next, membership))
  }

  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger
        aria-label={`Configure ${board.name}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings2 className="size-4" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{board.name}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-5 px-4 pb-8">
          {/* Live board preview: the installed hold sets' overlay art, so toggling
              a set below makes its holds appear/disappear. No markers (no problem
              selected) — mirrors iOS's HoldSetEditorView preview. Height-capped so
              the pills and Remove button stay reachable in the bottom sheet; the
              max-width is derived from the board aspect so height ≤ the cap and
              tall boards letterbox narrower rather than overflow. */}
          <div
            className="mx-auto w-full"
            style={{ maxWidth: `calc(45vh * ${board.geometry.width} / ${board.geometry.height})` }}
          >
            <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visible} />
          </div>
          {hasAngleChoice(board) && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Angle</div>
              <div className="flex gap-1.5">
                {board.angles.map((a) => (
                  <Toggle key={a} size="sm" variant="outline" pressed={angle === a} onPressedChange={() => onAngle(a)}>
                    {a}°
                  </Toggle>
                ))}
              </div>
            </div>
          )}
          {filterable.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Installed hold sets</div>
              <div className="flex flex-wrap gap-1.5">
                {filterable.map((id) => (
                  <Toggle
                    key={id}
                    size="sm"
                    variant="outline"
                    pressed={installed.has(id)}
                    disabled={installed.size === 1 && installed.has(id)}
                    onPressedChange={() => toggleSet(id)}
                  >
                    {setName(id)}
                  </Toggle>
                ))}
              </div>
            </div>
          )}
          <Button
            variant={confirmRemove ? 'destructive' : 'outline'}
            className="w-full"
            onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
          >
            {confirmRemove ? 'Confirm — remove this board' : 'Remove board'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
