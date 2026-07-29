// "My Boards": the boards the user owns. Each board is a clean row (name +
// config summary). The active board shows a primary "Browse" action into its
// catalog; every other owned board shows a secondary "Set as active" that just
// switches the active board (staying on this list). Tapping the config button
// opens a bottom drawer to edit angle and installed hold sets (or remove it) —
// mirroring iOS, where board config lives behind a separate sheet. Also the
// first-run surface (zero added boards).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanQrCode, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { BOARDS, hasAngleChoice, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { activeCsv, holdSetContext } from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import {
  SessionExitError,
  endActiveSessionLocally,
  exitSessionOnBoard,
  useSessions,
} from '../sessions/sessionsStore'
import {
  refreshBenchmarkNews,
  unseenCount,
  useBenchmarkNewsVersion,
} from '../catalog/benchmarkNewsStore'
import { useResumableSessions } from '../sessions/useResumableSessions'
import { ResumableSessionRow } from '../sessions/ResumableSessionRow'
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
  // Cross-device resume: list this user's live sessions (across all boards on this surface) so
  // they can re-adopt one created/joined elsewhere. The hook owns the fetch, self-heal, and
  // adopt-and-navigate; MyBoards just renders the section.
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions()

  const addedIds = new Set(addedBoards.map((b) => b.layoutId))
  const addable = BOARDS.filter((b) => !addedIds.has(b.layoutId))

  // Removing a board you're mid-session on drops you out of that session too — you can't be
  // on a wall you just said you don't have. The board is local state and goes FIRST: the exit
  // is a network call with no timeout, so awaiting it would leave a stalled connection holding
  // the drawer open with nothing happening. `exitSessionOnBoard` reads only the sessions store,
  // so it is unaffected by the board list changing under it.
  function handleRemove(board: CatalogBoardDef) {
    removeBoard(board.layoutId)
    void exitSessionOnBoard(board.layoutId)
      .then((exit) => {
        if (exit === 'ended') toast(`Ended your session on ${board.name}`)
        else if (exit === 'left') toast(`Left the session on ${board.name}`)
      })
      .catch((e: unknown) => {
        // This device is out either way; what differs is what is still true on the server, so
        // say that instead of asserting "offline" for what may be any failure.
        console.error('Could not exit the session on the removed board', e)
        endActiveSessionLocally()
        const endFailed = e instanceof SessionExitError && e.intent === 'ended'
        toast(endFailed ? 'Couldn’t end the session yet' : 'Left the session on this device', {
          description: endFailed
            ? 'It’s still running and its invite link still works — we’ll finish ending it next time you’re online.'
            : 'The others may still see you until we finish this next time you’re online.',
        })
      })
  }

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

  // Stable key over the visible slabs, so both the fetch effect and the dot-derivation memo
  // depend on a value that only changes when the added-boards set (or one of their angles)
  // actually changes — not on every render's fresh array identity.
  const slabsKey = orderedBoards.map((b) => `${b.layoutId}:${getAngle(b)}`).join('|')

  // Best-effort fetch of new-benchmark events for every added board on this page's mount +
  // whenever the added-set changes. Boards page must degrade cleanly offline / unconfigured —
  // the store handles that internally and returns zero-unseen without throwing.
  useEffect(() => {
    if (orderedBoards.length === 0) return
    void refreshBenchmarkNews(
      orderedBoards.map((b) => ({ layoutId: b.layoutId, angle: getAngle(b) })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slabsKey])

  // Reactive per-board dot map — a set of layoutIds with pending events, only computed when
  // the store version bumps or the visible slabs change (guards against a fresh Set every
  // render).
  const newsVersion = useBenchmarkNewsVersion()
  const boardsWithDot = useMemo(() => {
    void newsVersion
    const s = new Set<number>()
    for (const b of orderedBoards) {
      if (unseenCount(b.layoutId, getAngle(b)) > 0) s.add(b.layoutId)
    }
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsVersion, slabsKey])

  return (
    <div className="space-y-4">
      {!activeSession && resumable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resume session
          </h2>
          {resumable.map((s) => (
            <ResumableSessionRow
              key={s.id}
              session={s}
              disabled={resumingId === s.id}
              onResume={(sess) => void onResume(sess)}
            />
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
              // Dot on non-active added rows with pending events. Never shows on the active
              // row (its own catalog banner is the surface); cleared by the same watermark.
              hasNewBenchmarks={
                board.layoutId !== activeBoard.layoutId && boardsWithDot.has(board.layoutId)
              }
              // Active board → browse its catalog (already active, no switch).
              onBrowse={() => onActivated(board.layoutId)}
              // Inactive board → just switch the active board; stay on this list.
              onSetActive={() => activateBoard(board.layoutId)}
              onRemove={() => handleRemove(board)}
              // Warn before the fact: removing this board ends the session running on it.
              hasActiveSession={activeSession?.boardLayoutId === board.layoutId}
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
  /** The device's live session runs on this board — removing it will drop out of it. */
  hasActiveSession: boolean
  /** Pending benchmark_events on this row's slab → show the "new" dot beside the name. */
  hasNewBenchmarks: boolean
  onBrowse: () => void
  onSetActive: () => void
  onRemove: () => void
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
}

function BoardCard({
  board,
  active,
  hasActiveSession,
  hasNewBenchmarks,
  onBrowse,
  onSetActive,
  onRemove,
  onAngle,
  onHoldSets,
}: BoardCardProps) {
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
            {hasNewBenchmarks && (
              <span
                aria-label="New benchmarks available"
                data-testid={`new-benchmarks-dot-${board.layoutId}`}
                className="size-2 shrink-0 rounded-full bg-primary"
              />
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
          hasActiveSession={hasActiveSession}
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
  hasActiveSession: boolean
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
  onRemove: () => void
}

function BoardConfigDrawer({
  board,
  angle,
  hasActiveSession,
  onAngle,
  onHoldSets,
  onRemove,
}: BoardConfigDrawerProps) {
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
          <div className="space-y-1.5">
            <Button
              variant={confirmRemove ? 'destructive' : 'outline'}
              className="w-full"
              onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
              onBlur={() => setConfirmRemove(false)}
            >
              {confirmRemove ? 'Confirm — remove this board' : 'Remove board'}
            </Button>
            {hasActiveSession && (
              <p className="text-center text-xs text-muted-foreground">
                You’ll drop out of the session on this board — and end it if you’re the only one
                in it.
              </p>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
