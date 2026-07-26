// "Boards": the boards the user holds, as clean rows (name + config summary) split into
// the ones they set up themselves and the ones shared with them. The active board shows a
// primary "Browse" action into its catalog; every other board shows a secondary "Set as
// active" that just switches the active board (staying on this list). The config button
// opens the setup flow to edit angle and installed hold sets, or remove it — mirroring
// iOS, where board config lives behind a separate sheet. Also the first-run surface (zero
// boards).
//
// The two sections exist because one MoonBoard layout can back two boards at once — your
// own 2019 in the garage and a shared 2019 at the gym — and which is which changes what
// you're allowed to configure.

import { useRef, useState } from 'react'
import { Plus, ScanQrCode, Settings2 } from 'lucide-react'
import { BOARDS, hasAngleChoice } from '../board/boards'
import type { BoardInstance } from '../board/boardInstance'
import { instanceName, isSharedInstance } from '../board/boardInstance'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import { BoardSetupFlow } from './BoardSetupFlow'
import { useSessions } from '../sessions/sessionsStore'
import { useResumableSessions } from '../sessions/useResumableSessions'
import { ResumableSessionRow } from '../sessions/ResumableSessionRow'
import { ScanToJoinButton } from '../sessions/ScanToJoin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
  // adopt-and-navigate; MyBoards just renders the section.
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions()

  const [setUp, setSetUp] = useState<SetupTarget>(null)

  const addedIds = new Set(instances.map((i) => i.layoutId))
  const anythingLeftToAdd = BOARDS.some((b) => !addedIds.has(b.layoutId))

  // Freeze the row order for this mount. "Set as active" promotes the board to the MRU
  // front in the store, but the list must not reshuffle under the user's finger — only the
  // Active badge / Browse button swap in place. A fresh mount re-reads the MRU order
  // (active board on top). Boards added this session append; removed ones drop out —
  // membership stays live, only order is frozen. Seeded empty; the append loop below fills
  // it in MRU order on first render.
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

  // Partition the frozen order, so a board keeps its position within its own section.
  const own = ordered.filter((i) => !isSharedInstance(i))
  const shared = ordered.filter(isSharedInstance)

  const renderRow = (instance: BoardInstance) => (
    <BoardCard
      key={instance.instanceId}
      instance={instance}
      active={instance.instanceId === activeInstance.instanceId}
      // Active board → browse its catalog (already active, no switch).
      onBrowse={() => onActivated(instance.instanceId)}
      // Inactive board → just switch the active board; stay on this list.
      onSetActive={() => activateBoard(instance.instanceId)}
      onSetUp={() => setSetUp(instance)}
    />
  )

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
          <p className="mb-4 text-sm">Pick the MoonBoard you have to start browsing its problems.</p>
          <Button onClick={() => setSetUp('add')}>Add a board</Button>
        </div>
      ) : (
        <>
          {own.length > 0 && (
            <BoardSection title="My boards">{own.map(renderRow)}</BoardSection>
          )}
          {/* Hidden until a shared board exists, rather than an empty section advertising a
              feature that isn't wired up yet. */}
          {shared.length > 0 && (
            <BoardSection title="Shared with me">{shared.map(renderRow)}</BoardSection>
          )}
          {anythingLeftToAdd && (
            <Button variant="outline" className="w-full" onClick={() => setSetUp('add')}>
              <Plus className="size-4" />
              Add a board
            </Button>
          )}
        </>
      )}

      {setUp !== null && (
        <BoardSetupFlow
          instance={setUp === 'add' ? undefined : setUp}
          sharingAvailable={SHARING_AVAILABLE}
          onClose={() => setSetUp(null)}
        />
      )}
    </div>
  )
}

function BoardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface BoardCardProps {
  instance: BoardInstance
  active: boolean
  onBrowse: () => void
  onSetActive: () => void
  onSetUp: () => void
}

function BoardCard({ instance, active, onBrowse, onSetActive, onSetUp }: BoardCardProps) {
  const board = instance.layout
  const angle = getAngle(instance)
  const { filterable, active: installed } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(instance),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const subtitle = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')
  // A shared board carries its owner's name for it, which is what tells two boards of the
  // same layout apart. Its section already says it is shared, so the row needs no marker.
  const name = instanceName(instance)

  return (
    <Card className={cn('py-3', active ? 'border-primary/60 bg-primary/5' : 'bg-transparent')}>
      <CardContent className="flex items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            {active && <Badge className="shrink-0 bg-accent text-accent-foreground">Active</Badge>}
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
