// The board name in the header, and the drawer it opens: the one place to switch, add
// and manage boards. The drawer has no route of its own, so it opens over any screen
// without changing the URL.
//
// Top to bottom: the "That session has ended." notice, sessions to resume, the added
// boards as picture tiles with an add tile, and the "Scan a QR code" row.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronsUpDown, Pencil, Plus } from 'lucide-react'
import { BOARDS, type CatalogBoardDef } from '../board/boards'
import { getActiveHoldSetsRaw, getAngle, useBoardStore } from '../board/boardStore'
import { holdSetContext } from '../board/holdSetMembership'
import { catalogLayoutId, catalogNavTarget } from '../catalog/catalogNav'
import {
  refreshBenchmarkNews,
  unseenCount,
  useBenchmarkNewsVersion,
} from '../catalog/benchmarkNewsStore'
import { useSessions } from '../sessions/sessionsStore'
import { useResumableSessions } from '../sessions/useResumableSessions'
import { ResumableSessionRow } from '../sessions/ResumableSessionRow'
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { BoardTile } from './BoardTile'
import { shortBoardName } from './boardDisplay'
import { ScanQrRow } from './ScanQrRow'

/** The header's board name. Renders nothing until a board is added. */
export function BoardsDrawer() {
  const { addedBoards, activeBoard } = useBoardStore()
  const [open, setOpen] = useState(false)

  // The history entry the drawer was on when it sent the user to the add flow or an edit
  // page. Coming Back to that entry reopens the drawer, so Back from those pages returns
  // to where the user was: the drawer, not the screen under it.
  const returnKey = useRef<string | null>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const entryKey = useRouterState({ select: (s) => s.location.state?.__TSR_key ?? null })
  const rememberEntry = () => {
    returnKey.current = entryKey
  }

  useEffect(() => {
    if (returnKey.current !== null && entryKey === returnKey.current) {
      returnKey.current = null
      setOpen(true)
      return
    }
    // Landing anywhere outside the add and edit pages means that flow ended some other
    // way (a board was added or removed, a tab was tapped), so Back no longer reopens.
    if (!pathname.startsWith('/boards/')) returnKey.current = null
    // Leaving for any screen that is not a catalog closes the drawer (the edit page, the
    // add flow, the join route). A catalog-to-catalog change does not: switching boards
    // from the drawer swaps the catalog behind it and the drawer stays open.
    if (catalogLayoutId(pathname) === null) setOpen(false)
  }, [pathname, entryKey])

  if (addedBoards.length === 0) return null

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger
        aria-label={`${activeBoard.name}, boards`}
        className="flex min-w-0 items-center gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate text-base font-semibold">{activeBoard.name}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerTitle className="sr-only">Boards</DrawerTitle>
        {/* The drawer's own content element clips overflow, so the scroll lives here. */}
        <div className="max-h-[75dvh] overflow-y-auto px-4 pt-2 pb-6">
          <BoardsDrawerBody onClose={() => setOpen(false)} onOpenPage={rememberEntry} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'

/** The drawer's content. Mounts when the drawer opens, so everything it reads once
 *  (tile order, resumable sessions, benchmark news) is fresh per open. */
function BoardsDrawerBody({
  onClose,
  onOpenPage,
}: {
  onClose: () => void
  /** Called just before the drawer sends the user to the add flow or an edit page. */
  onOpenPage: () => void
}) {
  const navigate = useNavigate()
  const { addedBoards, activeBoard, activateBoard } = useBoardStore()
  // Joining a session is a no-session action, so the scan row hides once one is active.
  // Signed-out users still see it: the join route owns sign-in.
  const { activeSession } = useSessions()
  // Cross-device resume: this user's live sessions across all boards. The hook owns the
  // fetch, the self-heal and the adopt-and-navigate; the drawer renders the section.
  const { resumable, resumingId, endedNotice, onResume } = useResumableSessions()

  // A resumed session lands on its board's catalog, which is not a route change that
  // closes the drawer by itself — so close when a session becomes active under it.
  const hadSession = useRef(activeSession !== null)
  useEffect(() => {
    if (activeSession !== null && !hadSession.current) onClose()
    hadSession.current = activeSession !== null
  }, [activeSession, onClose])

  // Freeze the tile order for this open. Tapping an inactive tile promotes that board to
  // the front of the stored order, but the tiles must not reshuffle under the user's
  // finger — only the outline and "Browse" move. The next open re-reads the stored
  // order. Membership stays live: an added board appends, a removed one drops out.
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
  for (const b of addedBoards) if (byId.has(b.layoutId)) orderedBoards.push(b)
  orderRef.current = orderedBoards.map((b) => b.layoutId)

  // Stable key over the tiles' slabs, so the fetch effect and the dot memo depend on a
  // value that changes only when the added boards (or one of their angles) change.
  const slabsKey = orderedBoards.map((b) => `${b.layoutId}:${getAngle(b)}`).join('|')

  // Best-effort fetch of new-benchmark events for every added board. Degrades cleanly
  // offline / unconfigured: the store returns zero unseen without throwing.
  useEffect(() => {
    if (orderedBoards.length === 0) return
    void refreshBenchmarkNews(orderedBoards.map((b) => ({ layoutId: b.layoutId, angle: getAngle(b) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slabsKey])

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

  const canAdd = addedBoards.length < BOARDS.length

  return (
    <div className="space-y-5">
      {!activeSession && endedNotice && resumable.length === 0 && (
        <p
          role="status"
          className="rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground"
        >
          That session has ended.
        </p>
      )}
      {!activeSession && resumable.length > 0 && (
        <section className="space-y-2">
          <h2 className={sectionTitle}>Resume session</h2>
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
      <section className="space-y-2">
        <h2 className={sectionTitle}>My boards</h2>
        <div className="grid grid-cols-3 gap-2">
          {orderedBoards.map((board) => {
            const active = board.layoutId === activeBoard.layoutId
            const { visible } = holdSetContext(
              board.membershipResource,
              getActiveHoldSetsRaw(board.layoutId),
            )
            return (
              <BoardTile
                key={board.layoutId}
                board={board}
                visibleHoldSetIds={visible}
                title={shortBoardName(board)}
                angle={getAngle(board)}
                active={active}
                // Never on the active tile: its own catalog banner is that surface.
                dot={!active && boardsWithDot.has(board.layoutId)}
                label={active ? `Browse ${board.name}` : `Switch to ${board.name}`}
                onSelect={() => {
                  if (active) {
                    onClose()
                    void navigate(catalogNavTarget(board))
                  } else {
                    // Only the store changes here. On a catalog the shell follows the
                    // active board (useFollowActiveBoard); elsewhere the screen stays.
                    activateBoard(board.layoutId)
                  }
                }}
                corner={{
                  icon: <Pencil />,
                  label: `Edit ${board.name}`,
                  onClick: () => {
                    onOpenPage()
                    onClose()
                    void navigate({
                      to: '/boards/$layoutId/edit',
                      params: { layoutId: String(board.layoutId) },
                    })
                  },
                }}
              />
            )
          })}
          {canAdd && (
            <button
              type="button"
              className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => {
                onOpenPage()
                onClose()
                void navigate({ to: '/boards/add' })
              }}
            >
              <Plus className="size-5" />
              <span className="text-xs font-medium">Add a board</span>
            </button>
          )}
        </div>
      </section>
      {!activeSession && <ScanQrRow />}
    </div>
  )
}
