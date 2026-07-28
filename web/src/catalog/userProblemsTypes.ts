// Pure foundation for user-authored problems — the `user_problems` row shape (snake_case,
// matching migrations 0002 + 0018), a camelCase domain model, and side-effect-free mappers.
// No Supabase, no IndexedDB: userProblemsSync and userProblemsStore both import from here and
// this file stays trivially unit-testable. Mirrors lists/listsTypes.ts.

import type { CatalogHold } from './catalogSync'

/** Sharing intent (0018). `public` is storable now but serves nobody until 0019 adds the
 *  cross-user read policy — the client may record the intent either way. */
export type UserProblemVisibility = 'private' | 'public'

/**
 * A `user_problems` row as the client reads it.
 *
 * `layout_id` / `angle` are NULLABLE by design (0018/KTD1): every web-authored row carries
 * both, but the rows already in production came from the iOS logbook, which recorded
 * neither. Those legacy rows must never surface in a slab read yet stay resolvable by id.
 *
 * `source_catalog_id` is GENERATED ALWAYS ('user:' || id) server-side. It is the cache key
 * and IS selected on every read — but it must NEVER appear in an INSERT/UPDATE payload:
 * PostgREST treats it as read-only and the write would fail outright.
 */
export interface UserProblemRow {
  id: string
  user_id: string
  name: string
  grade: string
  holds: CatalogHold[]
  layout_id: number | null
  angle: number | null
  visibility: UserProblemVisibility
  source_catalog_id: string
  updated_at: string
  deleted: boolean
}

/**
 * The explicit column projection for every `user_problems` read and write-reconcile —
 * NEVER `*`. Keeping it in one constant is what stops a future column (0019's attribution,
 * say) from silently entering the offline cache unreviewed. Writes use
 * {@link userProblemInsertPayload} / {@link userProblemUpdatePayload}, never this list.
 */
export const USER_PROBLEM_COLUMNS =
  'id, user_id, name, grade, holds, layout_id, angle, visibility, source_catalog_id, updated_at, deleted'

/** The prefix migration 0018 generates onto every user problem's text id. Chosen so it
 *  cannot collide with the UUIDv5 catalog ids sharing the same lane. */
export const USER_PROBLEM_ID_PREFIX = 'user:'

/** A user-authored problem, camelCase, as the app passes it around. */
export interface UserProblem {
  /** The uuid primary key — what Supabase writes target. */
  id: string
  /** The `'user:' || id` text id shared with catalog problems; the cache key. */
  sourceCatalogId: string
  userId: string
  name: string
  grade: string
  holds: CatalogHold[]
  layoutId: number | null
  angle: number | null
  visibility: UserProblemVisibility
  updatedAt: string
  deleted: boolean
}

/** The text id a given user-problem uuid is referenced by — the client-side mirror of the
 *  generated column, used to key the optimistic row before the server echoes it back. */
export function userProblemCatalogId(id: string): string {
  return `${USER_PROBLEM_ID_PREFIX}${id}`
}

/** Whether a catalog-lane id refers to a user problem rather than an imported one. */
export function isUserProblemId(sourceCatalogId: string): boolean {
  return sourceCatalogId.startsWith(USER_PROBLEM_ID_PREFIX)
}

/** The uuid behind a `user:`-prefixed id, or null when the id is an imported catalog one. */
export function userProblemUuid(sourceCatalogId: string): string | null {
  return isUserProblemId(sourceCatalogId)
    ? sourceCatalogId.slice(USER_PROBLEM_ID_PREFIX.length)
    : null
}

export function fromUserProblemRow(r: UserProblemRow): UserProblem {
  return {
    id: r.id,
    sourceCatalogId: r.source_catalog_id,
    userId: r.user_id,
    name: r.name,
    grade: r.grade,
    // Legacy iOS rows and a hand-edited row can carry anything the jsonb column allows;
    // the app's renderers assume an array, so normalize at the boundary.
    holds: Array.isArray(r.holds) ? r.holds : [],
    layoutId: r.layout_id,
    angle: r.angle,
    visibility: r.visibility,
    updatedAt: r.updated_at,
    deleted: r.deleted,
  }
}

export function toUserProblemRow(p: UserProblem): UserProblemRow {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    grade: p.grade,
    holds: p.holds,
    layout_id: p.layoutId,
    angle: p.angle,
    visibility: p.visibility,
    source_catalog_id: p.sourceCatalogId,
    updated_at: p.updatedAt,
    deleted: p.deleted,
  }
}

/** The INSERT payload for a new row. Deliberately omits `source_catalog_id` (generated) and
 *  `updated_at` (trigger-stamped) — supplying either makes the write fail or drift. */
export function userProblemInsertPayload(row: UserProblemRow): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    grade: row.grade,
    holds: row.holds,
    layout_id: row.layout_id,
    angle: row.angle,
    visibility: row.visibility,
  }
}

/** The editable fields of an existing row. Same exclusions as the insert payload, plus
 *  `id`/`user_id`, which no edit may move. */
export interface UserProblemPatch {
  name?: string
  grade?: string
  holds?: CatalogHold[]
  visibility?: UserProblemVisibility
  deleted?: boolean
}

/** A patch as a snake_case UPDATE payload — only the keys the caller actually set. */
export function userProblemUpdatePayload(patch: UserProblemPatch): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (patch.name !== undefined) payload.name = patch.name
  if (patch.grade !== undefined) payload.grade = patch.grade
  if (patch.holds !== undefined) payload.holds = patch.holds
  if (patch.visibility !== undefined) payload.visibility = patch.visibility
  if (patch.deleted !== undefined) payload.deleted = patch.deleted
  return payload
}

/** Apply a patch to a cached row, producing the optimistic next row. */
export function applyUserProblemPatch(row: UserProblemRow, patch: UserProblemPatch): UserProblemRow {
  return {
    ...row,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
    ...(patch.holds !== undefined ? { holds: patch.holds } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.deleted !== undefined ? { deleted: patch.deleted } : {}),
  }
}
