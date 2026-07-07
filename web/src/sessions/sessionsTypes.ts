// Pure foundation for Collaboration Sessions — row interfaces (snake_case, matching
// migration 0007), camelCase domain types, and side-effect-free mappers/helpers. No
// Supabase, no storage: every other sessions module imports from here and this file stays
// trivially unit-testable. Mirrors the row-interface + `fromRow` shape of listsTypes.ts.

import type { StatusKey } from '../catalog/filters'

/**
 * A `sessions` row as the client reads it. Deliberately EXCLUDES `invite_token`: the
 * share-link capability secret must never reach the client cache or a persisted pointer
 * (KTD-7). It is fetched transiently on demand via the `session_invite_token` RPC. The
 * SESSION_COLUMNS projection selects exactly these columns.
 */
export interface SessionRow {
  id: string
  owner_id: string
  name: string
  board_layout_id: number
  expires_at: string
  created_at: string
  updated_at: string
  deleted: boolean
}

/**
 * Explicit column projection for every `sessions` read/insert-returning — NEVER `*` and
 * NEVER `invite_token`. Single source of the KTD-7 invariant that the share secret never
 * lands in state that gets persisted. `createSession` appends `, invite_token` for the
 * one transient RETURNING read, then drops it into volatile-only memory.
 */
export const SESSION_COLUMNS =
  'id, owner_id, name, board_layout_id, expires_at, created_at, updated_at, deleted'

/** A `session_members` row. */
export interface SessionMemberRow {
  session_id: string
  user_id: string
  joined_at: string
}

/** A collaboration session (one board; membership handled via the roster). */
export interface Session {
  id: string
  ownerId: string
  name: string
  boardLayoutId: number
  expiresAt: string
  createdAt: string
  updatedAt: string
  deleted: boolean
}

/**
 * A roster entry. `userId` + `joinedAt` come from `session_members`; `handle`/`displayName`
 * are filled from the batch `profiles` fetch (KTD-9) and stay null while it loads or when a
 * profile row is missing — the UI renders deterministic initials, NEVER the raw user-id.
 */
export interface SessionMember {
  userId: string
  joinedAt: string
  handle: string | null
  displayName: string | null
}

/** Per-member ascent-status chip selections, keyed by user-id (R3/R14). Lives in the
 *  session store (persisted per session), read by the catalog predicate via FilterContext. */
export type MemberStatus = Record<string, StatusKey[]>

export function fromSessionRow(r: SessionRow): Session {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    boardLayoutId: r.board_layout_id,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted,
  }
}

export function fromSessionMemberRow(
  r: SessionMemberRow,
  profile?: { handle: string; displayName: string } | null,
): SessionMember {
  return {
    userId: r.user_id,
    joinedAt: r.joined_at,
    handle: profile?.handle ?? null,
    displayName: profile?.displayName ?? null,
  }
}

/** Max stored/displayed session-name length — mirrors the server `session_name_len` check
 *  (0007) and the lists MAX_LIST_NAME cap. */
export const MAX_SESSION_NAME = 60

/** Normalize a raw session-name input: trim whitespace, cap length. Empty stays empty (the
 *  caller falls back to the auto-default). */
export function trimSessionName(raw: string): string {
  return raw.trim().slice(0, MAX_SESSION_NAME)
}

/** Auto-default session name (R18), e.g. "Mini 2025 · Jul 7". Date is passed in so this
 *  stays pure and testable. */
export function defaultSessionName(boardLabel: string, date: Date): string {
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const board = boardLabel.trim() || 'Board'
  return `${board} · ${day}`
}

/**
 * Deterministic 1–2 char initials for a roster row (KTD-9). Prefers display name, then
 * handle; falls back to a stable letter derived from the user-id so a missing profile still
 * renders a non-empty, non-identifying token — the raw user-id is never shown.
 */
export function memberInitials(m: Pick<SessionMember, 'displayName' | 'handle' | 'userId'>): string {
  const source = (m.displayName ?? m.handle ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
    return chars.toUpperCase()
  }
  // No profile yet: a stable single letter from the id hash (A–Z), never the id itself.
  let hash = 0
  for (const ch of m.userId) hash = (hash + ch.charCodeAt(0)) % 26
  return String.fromCharCode(65 + hash)
}

/** A short display label for a roster row — display name, then handle, then initials. */
export function memberLabel(m: SessionMember): string {
  return (m.displayName ?? m.handle ?? '').trim() || memberInitials(m)
}
