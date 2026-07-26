// The active board, rendered large: its art, what it is configured as, the viewer's own
// recent activity on it, and the two actions that matter (browse it, set it up).
//
// The hero is the Boards page's centre of gravity — the switcher below it exists only to
// change which instance is here. On a shared board a social layer joins the personal
// content rather than replacing it; that layer arrives with presence, and every share
// affordance stays behind `sharingAvailable` until then.

import { hasAngleChoice } from '../board/boards'
import { instanceName, type BoardInstance } from '../board/boardInstance'
import { getActiveHoldSetsRaw, getAngle } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import { CatalogBoard } from '../board/CatalogBoard'
import { useRecents } from '../catalog/recentsStore'
import { useResolvedProblem } from '../catalog/useResolvedProblem'
import { useEnsureAscentsLoaded } from '../logbook/ascents'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Height cap for the board art, as a max-width derived from the board's own aspect ratio
 * so height stays bounded and a tall board letterboxes narrower instead of overflowing.
 * Tighter than the config drawer's 45vh: the hero carries actions and a summary beneath
 * the art, and all of it has to survive a 375px-wide phone without scrolling them away.
 */
const ART_HEIGHT_CAP = '38vh'

interface BoardHeroProps {
  instance: BoardInstance
  onBrowse: () => void
  onSetUp: () => void
  /**
   * Whether sharing exists yet. False renders no share affordance anywhere in the hero —
   * not a disabled one, not a nudge. Flipped on when the sharing loop ships.
   */
  sharingAvailable: boolean
}

export function BoardHero({ instance, onBrowse, onSetUp, sharingAvailable }: BoardHeroProps) {
  const board = instance.layout
  const angle = getAngle(instance)
  const { filterable, active: installed, visible } = holdSetContext(
    board.membershipResource,
    getActiveHoldSetsRaw(instance),
  )
  const holdSummary =
    installed.size >= filterable.length ? 'All hold sets' : `${installed.size} of ${filterable.length} sets`
  const summary = [hasAngleChoice(board) ? `${angle}°` : null, holdSummary].filter(Boolean).join(' · ')

  return (
    <section aria-label="Active board" className="space-y-3">
      <div className="mx-auto w-full" style={{ maxWidth: `calc(${ART_HEIGHT_CAP} * ${board.geometry.width} / ${board.geometry.height})` }}>
        <CatalogBoard board={board} holds={[]} visibleHoldSetIds={visible} />
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold">{instanceName(instance)}</h2>
          <Badge className="shrink-0 bg-accent text-accent-foreground">Active</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>

      <PersonalActivity instance={instance} angle={angle} />

      <div className="flex gap-2">
        <Button className="flex-1" onClick={onBrowse}>
          Browse
        </Button>
        <Button variant="outline" className="flex-1" onClick={onSetUp}>
          Set up
        </Button>
      </div>
      {/* Share lives here once the sharing loop ships. Until then nothing renders — the
          absence is the Phase A boundary, asserted in the tests. */}
      {sharingAvailable && null}
    </section>
  )
}

/**
 * The viewer's own recent activity on this board: their last send and the problem they
 * last opened.
 *
 * Both sources are deliberate. Sends come from the logbook store — its ascents carry a
 * date and the problem's name, so "most recent" is answerable and renderable without a
 * catalog round-trip. The last-opened problem comes from the per-slab recents history,
 * which is localStorage-backed and therefore still there after a cold load, unlike the
 * in-memory last-opened pointer the catalog uses within a session.
 */
function PersonalActivity({ instance, angle }: { instance: BoardInstance; angle: number }) {
  const { ascents } = useEnsureAscentsLoaded()
  // Ascents reference a layout, so sibling instances of one layout share a logbook by
  // design — the same wall in two places is the same climbing history.
  const lastSend = ascents
    .filter((a) => a.boardLayoutId === instance.layoutId && a.sent)
    .reduce<(typeof ascents)[number] | null>(
      (best, a) => (best === null || a.date > best.date ? a : best),
      null,
    )

  const recentIds = useRecents(instance.layoutId, angle)
  const lastOpened = useResolvedProblem(recentIds[0] ?? null)

  if (!lastSend && !lastOpened) return null

  return (
    <dl className="space-y-1 text-sm">
      {lastSend && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">Last send</dt>
          <dd className="min-w-0 truncate font-medium">
            {lastSend.problemName}
            {lastSend.problemGrade && (
              <span className="ml-1.5 font-normal text-muted-foreground">{lastSend.problemGrade}</span>
            )}
          </dd>
        </div>
      )}
      {lastOpened && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">Last opened</dt>
          <dd className="min-w-0 truncate font-medium">
            {lastOpened.name}
            {lastOpened.grade && (
              <span className="ml-1.5 font-normal text-muted-foreground">{lastOpened.grade}</span>
            )}
          </dd>
        </div>
      )}
    </dl>
  )
}
