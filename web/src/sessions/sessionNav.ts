// The single canonical "session → board catalog" navigation, shared by JoinSession (post-join),
// MyBoards (post-resume), and SessionBar (post-in-context-resume) so the three landing paths
// can't drift. Lives here (not in any caller) for the same reason joinUrl.ts owns the join-URL
// shape.

import { useNavigate } from '@tanstack/react-router'
import { activateBoard, addBoard, instanceForLayout } from '../board/boardStore'
import { boardByLayoutId } from '../board/boards'
import { catalogNavTarget } from '../catalog/catalogNav'
import type { Session } from './sessionsTypes'

/** The navigate function returned by TanStack Router's useNavigate. */
type NavigateFn = ReturnType<typeof useNavigate>

/**
 * Land in a session's board catalog. Resolves the board from the STATIC catalog by layout id —
 * it does not require the board to be in the user's added boards — so a joiner/resumer lands
 * regardless of local board state. A session whose board this build doesn't ship falls back to
 * `/boards` rather than a dead no-op (never route a session tap through a fallback-less handler
 * like the board-browse `onActivated`).
 *
 * **Side effect — this mutates My Boards.** It adds a local instance of the session's board
 * when the device holds none, then activates it, so resuming/joining a session for a board the
 * user hasn't added on this device WILL add it to their My Boards. This is deliberate: MyBoards
 * derives its "Active" badge from the held instances with fallback to the MRU front, so setting
 * active-only-without-adding would leave MyBoards lying about which board is active while the
 * user is browsing a session on that board. The add matches user intent — they are actively
 * using this board — and the user can remove it after the session ends. The `/boards` fallback
 * stays honest because it never adds or activates.
 */
export function navigateToSessionBoard(navigate: NavigateFn, session: Session): void {
  const board = boardByLayoutId(session.boardLayoutId)
  if (board) {
    // A session names a *layout*, not an instance, so land on whichever instance of it
    // this device holds — adding one first if none, per the side-effect note above.
    addBoard(board.layoutId)
    const instance = instanceForLayout(board)
    activateBoard(instance.instanceId)
    void navigate(catalogNavTarget(instance))
  } else {
    void navigate({ to: '/boards' })
  }
}
