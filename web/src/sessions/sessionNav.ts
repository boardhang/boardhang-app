// The single canonical "session → board catalog" navigation, shared by JoinSession (post-join),
// MyBoards (post-resume), and SessionBar (post-in-context-resume) so the three landing paths
// can't drift. Lives here (not in any caller) for the same reason joinUrl.ts owns the join-URL
// shape.

import { useNavigate } from '@tanstack/react-router'
import { activateBoard } from '../board/boardStore'
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
 * **Side effect — `activateBoard` mutates My Boards.** `activateBoard` writes the ACTIVE_KEY
 * pointer AND promotes the board to the head of the added-boards list, so resuming/joining a
 * session for a board the user hasn't added on this device WILL add it to their My Boards.
 * This is deliberate: MyBoards derives its "Active" badge from `addedBoards.find(activeId)`
 * with fallback to `addedBoards[0]`, so setting active-only-without-adding would leave MyBoards
 * lying about which board is active while the user is browsing a session on that board. The
 * add matches user intent — they are actively using this board — and the user can remove it
 * from MyBoards after the session ends. The `/boards` fallback stays honest because it never
 * calls activateBoard.
 */
export function navigateToSessionBoard(navigate: NavigateFn, session: Session): void {
  const board = boardByLayoutId(session.boardLayoutId)
  if (board) {
    activateBoard(board.layoutId)
    void navigate(catalogNavTarget(board))
  } else {
    void navigate({ to: '/boards' })
  }
}
