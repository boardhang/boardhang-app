// Assembles the per-problem "who sent it" avatars for the catalog rows from the session +
// projection stores. When a session targets this board, a row with ≥1 sender shows a "sends
// pill" (a green check + an avatar group) of everyone in the crew who has a logged SEND of that
// problem — self INCLUDED (self sorts first, ringed, labeled "You"). This is the row-decoration
// view of the same projection useSessionFilterRows renders as filter chips.
//
// The pure builder is split out (buildSenders) so it is unit-testable without mocking the stores;
// the hook is the thin store-reading wrapper, mirroring useSessionFilterRows' store reads.

import { useMemo } from 'react'
import type { CatalogBoardDef } from '../board/boards'
import { useSessions } from '../sessions/sessionsStore'
import { useMemberAscents } from '../sessions/memberAscentsStore'
import type { MemberAscentsMap } from '../sessions/memberAscentsStore'
import { memberInitials, memberLabel, type SessionMember } from '../sessions/sessionsTypes'

/** One sender chip in a row's sends pill — a crew member (self included) who sent that problem. */
export interface SenderChip {
  userId: string
  /** True for the current user — the avatar renders a self ring and sorts first. */
  isSelf: boolean
  /** The member's display label ("You" for self) — the avatar `title` + the pill's aria-label. */
  label: string
  /** Member initials for the avatar fallback (never blank — deterministic from user-id). */
  initials: string
  /** Public avatar URL, or null → the avatar renders initials. */
  avatarUrl: string | null
}

export interface MemberSendersUI {
  /** Sender chips keyed by `source_catalog_id`; absent key = nobody in the crew (self included)
   *  has sent it. */
  senders: Map<string, SenderChip[]>
  /** 'loading' = projection unready (render nothing yet); 'ready' = live; 'paused' = projection
   *  errored OR dropped by max-age. On the ERROR path the store keeps the last-good map, so the
   *  pill renders DIMMED; on the max-age drop the store empties the map, so there is nothing to
   *  render and the pill simply disappears until the next refresh. */
  state: 'loading' | 'ready' | 'paused'
}

/**
 * Pure: fold the per-member send sets into a `source_catalog_id → SenderChip[]` map, self
 * INCLUDED and sorted first (so every problem's pill leads with "You" when you've sent it).
 * Other members follow in the server-consistent snapshot order (`members`) so ordering is
 * deterministic; roster supplies labels/initials/avatar, with a synthetic fallback so a member
 * whose profile has not loaded still yields non-blank initials rather than being dropped.
 */
export function buildSenders(
  members: string[],
  selfId: string | null,
  bySets: MemberAscentsMap,
  roster: SessionMember[],
): Map<string, SenderChip[]> {
  const rosterById = new Map(roster.map((m) => [m.userId, m]))
  // Self first, then snapshot order — so within each problem's list self is pushed before others.
  const ordered = [...members].sort((a, b) => (a === selfId ? -1 : b === selfId ? 1 : 0))
  const senders = new Map<string, SenderChip[]>()
  for (const uid of ordered) {
    const sent = bySets[uid]?.sentIds
    if (!sent || sent.size === 0) continue
    const isSelf = uid === selfId
    const m = rosterById.get(uid)
    const synthetic = { userId: uid, displayName: null, handle: null }
    const chip: SenderChip = {
      userId: uid,
      isSelf,
      label: isSelf ? 'You' : m ? memberLabel(m) : memberInitials(synthetic),
      initials: memberInitials(m ?? synthetic),
      avatarUrl: m?.avatarUrl ?? null,
    }
    for (const id of sent) {
      const list = senders.get(id)
      if (list) list.push(chip)
      else senders.set(id, [chip])
    }
  }
  return senders
}

/**
 * The per-problem sender avatars for `board`'s active session, or undefined when no session
 * targets this board. Mirrors useSessionFilterRows' store reads and its ready/paused/loading
 * derivation so the row decoration and the filter chips are always in the same state.
 */
export function useMemberSenders(board: CatalogBoardDef): MemberSendersUI | undefined {
  const { activeSession, roster, selfId } = useSessions()
  const sessionForBoard =
    activeSession && activeSession.boardLayoutId === board.layoutId ? activeSession : null
  const memberAsc = useMemberAscents(sessionForBoard?.id ?? null)

  return useMemo<MemberSendersUI | undefined>(() => {
    if (!sessionForBoard) return undefined
    const senders = buildSenders(memberAsc.members, selfId, memberAsc.bySets, roster)
    const state: MemberSendersUI['state'] = memberAsc.ready
      ? 'ready'
      : memberAsc.stale || memberAsc.error
        ? 'paused'
        : 'loading'
    return { senders, state }
  }, [sessionForBoard, roster, selfId, memberAsc.members, memberAsc.bySets, memberAsc.ready, memberAsc.stale, memberAsc.error])
}
