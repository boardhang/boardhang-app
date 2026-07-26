// "My Boards": the boards the user owns. Each board is a clean row (name +
// config summary). The active board shows a primary "Browse" action into its
// catalog; every other owned board shows a secondary "Set as active" that just
// switches the active board (staying on this list). Tapping the config button
// opens a bottom drawer to edit angle and installed hold sets (or remove it) —
// mirroring iOS, where board config lives behind a separate sheet. Also the
// first-run surface (zero added boards).

import { useRef, useState } from 'react'
import { ScanQrCode, Settings2 } from 'lucide-react'
import { BOARDS, hasAngleChoice } from '../board/boards'
import type { BoardInstance } from '../board/boardInstance'
import { instanceName } from '../board/boardInstance'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { activeCsv, holdSetContext } from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import { useSessions } from '../sessions/sessionsStore'
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
  /** Jump to the catalog after activating a board (given its instance id). */
  onActivated: (instanceId: string) => void
}

export function MyBoards({ onActivated }: MyBoardsProps) {
  const { instances, activeInstance, addBoard, removeBoard, activateBoard, setAngle, setActiveHoldSetsRaw } =
    useBoardStore()
  // Joining a session is a no-session action, so hide the scan affordance once one is active
  // (mirrors the catalog StartBar/ActiveBar swap). Signed-out users still see it — the join
  // route owns sign-in.
  const { activeSession } = useSessions()
  // Cross-device resume: list this user's live sessions (across all boards on this surface) so
  // they can re-adopt one created/joined elsewhere. The hook owns the fetch, self-heal, and
  // adopt-and-navigate; MyBoards just renders the section.
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions()

  const addedIds = new Set(instances.map((i) => i.layoutId))
  const addable = BOARDS.filter((b) => !addedIds.has(b.layoutId))

  // Freeze the row order for this mount. "Set as active" promotes the board to
  // the MRU front in the store, but the list must not reshuffle under the user's
  // finger — only the Active badge / Browse button swap in place. A fresh mount
  // re-reads the MRU order (active board on top). Boards added this session
  // append; removed ones drop out — membership stays live, only order is frozen.
  // Seeded empty; the append loop below fills it in MRU order on first render.
  const orderRef = useRef<string[]>([])
  const byId = new Map(instances.map((i) => [i.instanceId, i] as const))
  const orderedBoards: BoardInstance[] = []
  for (const id of orderRef.current) {
    const i = byId.get(id)
    if (i) {
      orderedBoards.push(i)
      byId.delete(id)
    }
  }
  for (const i of instances) if (byId.has(i.instanceId)) orderedBoards.push(i) // newly added this session
  orderRef.current = orderedBoards.map((i) => i.instanceId)

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
      {instances.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Add your first board</p>
          <p className="text-sm">Pick the MoonBoard you have to start browsing its problems.</p>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My boards
          </h2>
          {orderedBoards.map((instance) => (
            <BoardCard
              key={instance.instanceId}
              instance={instance}
              active={instance.instanceId === activeInstance.instanceId}
              // Active board → browse its catalog (already active, no switch).
              onBrowse={() => onActivated(instance.instanceId)}
              // Inactive board → just switch the active board; stay on this list.
              onSetActive={() => activateBoard(instance.instanceId)}
              onRemove={() => removeBoard(instance.instanceId)}
              onAngle={(angle) => setAngle(instance, angle)}
              onHoldSets={(csv) => setActiveHoldSetsRaw(instance, csv)}
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
  instance: BoardInstance
  active: boolean
  onBrowse: () => void
  onSetActive: () => void
  onRemove: () => void
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
}

function BoardCard({ instance, active, onBrowse, onSetActive, onRemove, onAngle, onHoldSets }: BoardCardProps) {
  const board = instance.layout
  const angle = getAngle(instance)
  const { filterable, active: installed } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(instance),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const subtitle = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')

  return (
    <Card className={cn('py-3', active ? 'border-primary/60 bg-primary/5' : 'bg-transparent')}>
      <CardContent className="flex items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{instanceName(instance)}</span>
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
          instance={instance}
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
  instance: BoardInstance
  angle: number
  onAngle: (angle: number) => void
  onHoldSets: (csv: string) => void
  onRemove: () => void
}

function BoardConfigDrawer({ instance, angle, onAngle, onHoldSets, onRemove }: BoardConfigDrawerProps) {
  const board = instance.layout
  const { membership, filterable, active: installed, visible } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(instance),
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
        aria-label={`Configure ${instanceName(instance)}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings2 className="size-4" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{instanceName(instance)}</DrawerTitle>
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
