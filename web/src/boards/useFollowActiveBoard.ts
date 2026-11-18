// Keeps the catalog on screen and the active board in step, in both directions, so the
// header never names a different board than the catalog shows.
//
//  • The active board changed while another board's catalog is showing (a tile tapped
//    in the boards drawer, the active board removed in another tab) → replace the route
//    with the new active board's catalog.
//  • A catalog route for an added board that is not active (browser Back onto an older
//    catalog entry, a shared problem link, "Add this board" on a preview) → make that
//    board active.
//
// Nothing happens off the catalog, on the preview of a board that is not added (the
// header keeps naming the active board there), or when the routed board already is
// the active one — which is what leaves `?problem`, `?q` and the filters alone when
// the board on screen is the one being activated.

import { useEffect, useRef } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useBoardStore } from '../board/boardStore'
import { catalogNavTarget } from '../catalog/catalogNav'

const CATALOG_PATH = /^\/board\/(\d+)\/catalog\/?$/

/** The layout id of the catalog a pathname points at, or null for any other route. */
export function catalogLayoutId(pathname: string): number | null {
  const match = CATALOG_PATH.exec(pathname)
  return match ? Number(match[1]) : null
}

export function useFollowActiveBoard(): void {
  const router = useRouter()
  const navigate = useNavigate()
  const { addedBoards, activeBoard, activateBoard } = useBoardStore()

  const activeId = addedBoards.length > 0 ? activeBoard.layoutId : null
  const addedKey = addedBoards.map((b) => b.layoutId).join('|')
  // Re-run when the routed catalog changes; the effect itself reads the history's own
  // location, which is already the destination while a navigation is still loading.
  const resolvedPath = useRouterState({ select: (s) => s.location.pathname })

  const previousActiveId = useRef(activeId)
  useEffect(() => {
    const activeChanged = previousActiveId.current !== activeId
    previousActiveId.current = activeId
    if (activeId === null) return

    // The latest location, not the resolved one: a caller that activates a board and
    // navigates to its catalog in the same breath (resuming a session, finishing the
    // add flow) is already on its way there, and must not get a second navigation.
    const routedId = catalogLayoutId(router.history.location.pathname)
    if (routedId === null || routedId === activeId) return

    if (activeChanged) {
      void navigate({ ...catalogNavTarget(activeBoard), replace: true })
    } else if (addedBoards.some((b) => b.layoutId === routedId)) {
      activateBoard(routedId)
    }
    // `activeBoard` and `addedBoards` are covered by `activeId` and `addedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, addedKey, resolvedPath, router, navigate, activateBoard])
}
