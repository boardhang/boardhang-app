// Assembles the per-member "Ascent status" rows for the Filters sheet from the session +
// projection stores. Consumed DIRECTLY by FilterControls (renders the rows) and FilterSheet
// (badge count) — the same store-hook pattern SessionBar/SessionPill use — so the session UI
// state is not prop-drilled CatalogScreen -> FilterSheet -> FilterControls.
//
// This is the UI-row view of the session. The list predicate's view (per-member Set-pairs in
// FilterContext) is assembled separately in CatalogScreen, where applyFilters runs.

import { useMemo } from 'react'
import type { CatalogBoardDef } from '../board/boards'
import { getSessionsSnapshot, refreshActiveSession, setMemberStatus, useSessions } from '../sessions/sessionsStore'
import { refreshMemberAscents, useMemberAscents } from '../sessions/memberAscentsStore'
import { memberInitials, memberLabel } from '../sessions/sessionsTypes'
import type { StatusKey } from './filters'

/** One member's row in the per-member "Ascent status" section (U5). */
export interface MemberFilterRow {
  userId: string
  /** Name shown on the avatar's hover tooltip — "You" for self, else the member's label. */
  label: string
  /** Member initials for the avatar. */
  initials: string
  isSelf: boolean
  selected: StatusKey[]
  onToggle: (k: StatusKey, active: boolean) => void
}

/** Active-session status UI. When present the "Ascent status" section renders one row per
 *  member (self first) instead of the single self row. */
export interface SessionFilterUI {
  rows: MemberFilterRow[]
  /** 'loading' = projection unready (first load); 'ready' = live; 'paused' = projection
   *  errored or dropped by max-age, so cross-member filtering is off and the list is widened. */
  state: 'loading' | 'ready' | 'paused'
  /** Re-fetch the projection to reapply (wired to the session bar's refresh — U7). */
  onRefresh: () => void
}

/**
 * The per-member rows for `board`'s active session, or undefined when no session targets this
 * board. Self is ordered first and labeled "You"; the rendered member set is keyed off the
 * server-consistent projection snapshot (roster supplies labels only) so the rows shown and
 * the members filtered are always the same set even while names load.
 */
export function useSessionFilterRows(board: CatalogBoardDef): SessionFilterUI | undefined {
  const { activeSession, roster, memberStatus, selfId } = useSessions()
  const sessionForBoard =
    activeSession && activeSession.boardLayoutId === board.layoutId ? activeSession : null
  const memberAsc = useMemberAscents(sessionForBoard?.id ?? null)

  return useMemo<SessionFilterUI | undefined>(() => {
    if (!sessionForBoard) return undefined
    const rosterById = new Map(roster.map((m) => [m.userId, m]))
    const memberIds = memberAsc.members.length > 0 ? memberAsc.members : roster.map((m) => m.userId)
    const ordered = [...memberIds].sort((a, b) => (a === selfId ? -1 : b === selfId ? 1 : 0))
    const rows = ordered.map((uid) => {
      const isSelf = uid === selfId
      const m = rosterById.get(uid)
      const synthetic = { userId: uid, displayName: null, handle: null }
      const label = isSelf ? 'You' : m ? memberLabel(m) : memberInitials(synthetic)
      const initials = memberInitials(m ?? synthetic)
      return {
        userId: uid,
        label,
        initials,
        isSelf,
        selected: memberStatus[uid] ?? [],
        onToggle: (k: StatusKey, active: boolean) => {
          const cur = getSessionsSnapshot().memberStatus[uid] ?? []
          setMemberStatus(uid, active ? [...cur, k] : cur.filter((x) => x !== k))
        },
      }
    })
    const state: SessionFilterUI['state'] = memberAsc.ready
      ? 'ready'
      : memberAsc.stale || memberAsc.error
        ? 'paused'
        : 'loading'
    return {
      rows,
      state,
      onRefresh: () => {
        void refreshMemberAscents()
        void refreshActiveSession({ manual: true })
      },
    }
  }, [sessionForBoard, roster, memberStatus, selfId, memberAsc.members, memberAsc.ready, memberAsc.stale, memberAsc.error])
}
