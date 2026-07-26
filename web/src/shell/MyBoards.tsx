// "Boards": the boards the user holds, led by the active one as a hero. Below it a
// compact switcher lists the others — tapping one promotes it into the hero. Session
// controls are demoted to a strip that only appears when there is something to resume or
// join, because a board you climb on is this page's subject and a session is an occasional
// overlay on it. Also the first-run surface (zero instances).
//
// Adding and configuring both go through BoardSetupFlow — this screen only decides which
// board (if any) that flow opens on.

import { useRef, useState } from 'react'
import { Plus, ScanQrCode, Settings2 } from 'lucide-react'
import { BOARDS, hasAngleChoice } from '../board/boards'
import type { BoardInstance } from '../board/boardInstance'
import { instanceName } from '../board/boardInstance'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import { BoardHero } from './BoardHero'
import { BoardSetupFlow } from './BoardSetupFlow'
import { useSessions } from '../sessions/sessionsStore'
import { useResumableSessions } from '../sessions/useResumableSessions'
import { ResumableSessionRow } from '../sessions/ResumableSessionRow'
import { ScanToJoinButton } from '../sessions/ScanToJoin'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Whether the sharing loop exists yet. A single flag so every share entry point on this
 * page appears at once rather than leaking in half-built; the sharing units flip it.
 */
const SHARING_AVAILABLE = false

/** What the setup flow is open on: adding a new board, configuring one, or closed. */
type SetupTarget = 'add' | BoardInstance | null

interface MyBoardsProps {
  /** Jump to the catalog after activating a board (given its instance id). */
  onActivated: (instanceId: string) => void
}

export function MyBoards({ onActivated }: MyBoardsProps) {
  const { instances, activeInstance, activateBoard } = useBoardStore()
  // Joining a session is a no-session action, so hide the scan affordance once one is active
  // (mirrors the catalog StartBar/ActiveBar swap). Signed-out users still see it — the join
  // route owns sign-in.
  const { activeSession } = useSessions()
  // Cross-device resume: list this user's live sessions (across all boards on this surface) so
  // they can re-adopt one created/joined elsewhere. The hook owns the fetch, self-heal, and
  // adopt-and-navigate; this screen just renders the section.
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions()

  const [setUp, setSetUp] = useState<SetupTarget>(null)

  const addedIds = new Set(instances.map((i) => i.layoutId))
  const anythingLeftToAdd = BOARDS.some((b) => !addedIds.has(b.layoutId))

  // Freeze the switcher order for this mount. Activating promotes the instance to the MRU
  // front in the store, but the list must not reshuffle under the user's finger — the
  // tapped instance and the outgoing hero exchange slots and nothing else moves. A fresh
  // mount re-reads the MRU order. Instances added this session append; removed ones drop
  // out — membership stays live, only order is frozen. Seeded empty; the append loop below
  // fills it in MRU order on first render.
  const orderRef = useRef<string[]>([])
  const byId = new Map(instances.map((i) => [i.instanceId, i] as const))
  const ordered: BoardInstance[] = []
  for (const id of orderRef.current) {
    const i = byId.get(id)
    if (i) {
      ordered.push(i)
      byId.delete(id)
    }
  }
  for (const i of instances) if (byId.has(i.instanceId)) ordered.push(i) // newly added this session
  orderRef.current = ordered.map((i) => i.instanceId)

  /**
   * Promote an instance into the hero, exchanging frozen slots with the outgoing hero.
   *
   * The switcher renders the frozen order minus whichever instance is in the hero, so
   * swapping the two ids here is what makes the outgoing hero land in exactly the slot the
   * promoted one vacated. Without the swap, promoting anything other than the frozen
   * front would shuffle every row between them.
   */
  function promote(instanceId: string) {
    const order = orderRef.current
    const from = order.indexOf(instanceId)
    const to = order.indexOf(activeInstance.instanceId)
    if (from !== -1 && to !== -1) {
      order[from] = activeInstance.instanceId
      order[to] = instanceId
    }
    activateBoard(instanceId)
  }

  // Sessions, demoted: nothing renders while one is active (the session pill and the
  // catalog's own bar carry those controls), and only what exists renders otherwise. It
  // stays available at first-run on purpose — resuming a session started on another device
  // adds its board, which is exactly what someone with no boards here needs.
  const sessionStrip = !activeSession && (
    <section aria-label="Sessions" className="space-y-2">
      {resumable.length > 0 && (
        <>
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
        </>
      )}
      {endedNotice && resumable.length === 0 && (
        <p
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          That session has ended.
        </p>
      )}
      <ScanToJoinButton variant="outline" className="w-full">
        <ScanQrCode className="size-4" />
        Join a session
      </ScanToJoinButton>
    </section>
  )

  const setupFlow = setUp !== null && (
    <BoardSetupFlow
      instance={setUp === 'add' ? undefined : setUp}
      sharingAvailable={SHARING_AVAILABLE}
      onClose={() => setSetUp(null)}
    />
  )

  if (instances.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Add your first board</p>
          <p className="mb-4 text-sm">Pick the MoonBoard you have to start browsing its problems.</p>
          <Button onClick={() => setSetUp('add')}>Add a board</Button>
        </div>
        {sessionStrip}
        {setupFlow}
      </div>
    )
  }

  const others = ordered.filter((i) => i.instanceId !== activeInstance.instanceId)

  return (
    <div className="space-y-5">
      <BoardHero
        instance={activeInstance}
        onBrowse={() => onActivated(activeInstance.instanceId)}
        onSetUp={() => setSetUp(activeInstance)}
        sharingAvailable={SHARING_AVAILABLE}
      />

      {sessionStrip}

      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My boards
          </h2>
          {others.map((instance) => (
            <SwitcherRow
              key={instance.instanceId}
              instance={instance}
              onSetActive={() => promote(instance.instanceId)}
              onSetUp={() => setSetUp(instance)}
            />
          ))}
        </section>
      )}

      {anythingLeftToAdd && (
        <Button variant="outline" className="w-full" onClick={() => setSetUp('add')}>
          <Plus className="size-4" />
          Add a board
        </Button>
      )}

      {setupFlow}
    </div>
  )
}

/**
 * One non-active instance. Compact by design: its whole job is to become the hero, so it
 * carries a thumbnail, its name and config summary, and the switch action. Two instances
 * of one layout are told apart by the owner-set name a shared board carries.
 */
function SwitcherRow({
  instance,
  onSetActive,
  onSetUp,
}: {
  instance: BoardInstance
  onSetActive: () => void
  onSetUp: () => void
}) {
  const board = instance.layout
  const angle = getAngle(instance)
  const { filterable, active: installed, visible } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(instance),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const subtitle = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')
  const name = instanceName(instance)

  return (
    <Card className="bg-transparent py-3">
      <CardContent className="flex items-center gap-1 px-3">
        {/* The row itself switches. A "Set as active" button here would eat the width the
            name needs, and on a phone the name is the only thing telling two instances of
            the same layout apart — so it gets the room instead. */}
        <button
          type="button"
          aria-label={`Switch to ${name}`}
          onClick={onSetActive}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 pr-1 text-left transition-colors hover:bg-accent/50"
        >
          <span className="w-10 shrink-0">
            <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visible} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`Configure ${name}`}
          onClick={onSetUp}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="size-4" />
        </button>
      </CardContent>
    </Card>
  )
}
