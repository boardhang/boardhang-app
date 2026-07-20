// Shared types + row mappers for the social (follow-feed) surface. The RPCs in
// 0017_social_rpcs.sql return snake_case rows; the app works in camelCase. `handle` comes
// back as text (0017 returns handle::text to sidestep citext under an empty search_path), and
// avatar values are the raw stored object path — resolved to a public URL here, exactly like
// auth/types.ts profileFromRow.

import { avatarPublicUrl } from '../auth/avatarStorage'

/** The viewer's follow edge toward another user: none, a pending request, or an active follow. */
export type EdgeStatus = 'none' | 'pending' | 'active'

// ─── Profile card (get_profile_card / search_profiles / suggest_co_members) ───

export interface ProfileCard {
  id: string
  handle: string
  displayName: string
  /** Public URL derived from the stored avatar path, or null. */
  avatarUrl: string | null
  isPrivate: boolean
}

export interface ProfileCardRow {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
  is_private: boolean
}

export function cardFromRow(row: ProfileCardRow): ProfileCard {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: avatarPublicUrl(row.avatar_url),
    isPrivate: row.is_private,
  }
}

/** A search result adds the viewer's current edge status toward the row (for the button). */
export interface SearchResultRow extends ProfileCardRow {
  edge_status: EdgeStatus | null
}

export interface SearchResult extends ProfileCard {
  edgeStatus: EdgeStatus
}

export function searchResultFromRow(row: SearchResultRow): SearchResult {
  return { ...cardFromRow(row), edgeStatus: row.edge_status ?? 'none' }
}

// ─── A send (get_user_sends projection) ──────────────────────────────────────

export interface SendItem {
  ascentId: string
  actorId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  sourceCatalogId: string | null
  userProblemId: string | null
  problemName: string
  problemGrade: string
  boardLayoutId: number
  /** When the climb happened (display: "sent 3 days ago"). */
  climbedAt: string
  /** Server arrival stamp — the feed's sort key (never shown; drives keyset paging). */
  firstSentAt: string
}

export interface SendRow {
  ascent_id: string
  actor_id: string
  handle: string
  display_name: string
  avatar_url: string | null
  source_catalog_id: string | null
  user_problem_id: string | null
  problem_name: string
  problem_grade: string
  board_layout_id: number
  climbed_at: string
  first_sent_at: string
}

// ─── Notifications (get_notifications activity rows) ──────────────────────────

/** A fire-and-forget activity notification: a new follower, or an accepted request. */
export type NotificationType = 'follow' | 'follow_accepted'

export interface NotificationItem {
  id: string
  type: NotificationType
  actorId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationRow {
  id: string
  type: NotificationType
  actor_id: string
  handle: string
  display_name: string
  avatar_url: string | null
  created_at: string
  read_at: string | null
}

export function notificationFromRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: avatarPublicUrl(row.avatar_url),
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

/** A pending follow request (from get_follow_requests) is a profile card + when it was made. */
export interface FollowRequest extends ProfileCard {
  requestedAt: string
}

export interface FollowRequestRow extends ProfileCardRow {
  requested_at: string
}

export function followRequestFromRow(row: FollowRequestRow): FollowRequest {
  return { ...cardFromRow(row), requestedAt: row.requested_at }
}

export function sendFromRow(row: SendRow): SendItem {
  return {
    ascentId: row.ascent_id,
    actorId: row.actor_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: avatarPublicUrl(row.avatar_url),
    sourceCatalogId: row.source_catalog_id,
    userProblemId: row.user_problem_id,
    problemName: row.problem_name,
    problemGrade: row.problem_grade,
    boardLayoutId: row.board_layout_id,
    climbedAt: row.climbed_at,
    firstSentAt: row.first_sent_at,
  }
}
