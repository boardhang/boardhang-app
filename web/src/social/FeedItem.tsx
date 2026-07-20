// One send in the feed: actor avatar + "@handle · Problem Grade · Board" + relative climb time.
// Tapping a catalog send opens the problem in its board catalog via the ?problem drawer (the
// same history-integrated navigation the queue/catalog use). A user-problem send (no catalog id)
// isn't openable in the bundled catalog, so it renders as plain text.

import { useNavigate } from '@tanstack/react-router'
import { boardByLayoutId } from '../board/boards'
import { catalogNavTarget } from '../catalog/catalogNav'
import { PersonAvatar } from './PersonAvatar'
import { relativeTime } from './relativeTime'
import type { SendItem } from './socialTypes'

/** Show the actor's avatar (feed groups mix actors); a burst hides it via `hideAvatar`. */
export function FeedItem({ send, hideAvatar = false }: { send: SendItem; hideAvatar?: boolean }) {
  const navigate = useNavigate()
  const board = boardByLayoutId(send.boardLayoutId)
  const openable = Boolean(send.sourceCatalogId && board)

  function open() {
    if (!openable || !board) return
    const target = catalogNavTarget(board)
    void navigate({ ...target, search: { ...target.search, problem: send.sourceCatalogId as string } })
  }

  const body = (
    <>
      {!hideAvatar && (
        <PersonAvatar
          handle={send.handle}
          displayName={send.displayName}
          userId={send.actorId}
          avatarUrl={send.avatarUrl}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {!hideAvatar && <span className="font-medium">@{send.handle}</span>}
          {!hideAvatar && ' · '}
          <span className="font-medium">{send.problemName}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {send.problemGrade}
          {board ? ` · ${board.name}` : ''} · {relativeTime(send.climbedAt)}
        </p>
      </div>
    </>
  )

  if (openable) {
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </button>
    )
  }
  return <div className="flex items-center gap-3 py-3">{body}</div>
}
