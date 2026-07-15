// Pure foundation for the Session Playlist Queue — the `session_queue` row interface
// (snake_case, matching migration 0015), the camelCase domain type, side-effect-free
// mappers, and the deterministic sort comparators. No Supabase, no storage: queueStore
// imports from here and this file stays trivially unit-testable. Mirrors the
// row-interface + `fromRow` shape of listsTypes.ts / sessionsTypes.ts.

/**
 * A `session_queue` row as the client reads it (migration 0015). `added_by` / `done_by`
 * are attribution only (server-authoritative — pinned by the 0015 trigger, never trusted
 * from the client). A row is *active* (`done_at === null`), *done* (`done_at` set), or
 * *removed* (`deleted === true`, soft-delete via UPDATE — no DELETE policy).
 */
export interface QueueItemRow {
  id: string
  session_id: string
  source_catalog_id: string
  board_layout_id: number
  added_by: string | null
  position: number
  done_at: string | null
  done_by: string | null
  created_at: string
  updated_at: string
  deleted: boolean
}

/**
 * Explicit column projection for every `session_queue` read / insert-returning — NEVER
 * `*`. Single source of the read shape shared by fetchQueue and every write reconcile.
 */
export const QUEUE_COLUMNS =
  'id, session_id, source_catalog_id, board_layout_id, added_by, position, done_at, done_by, created_at, updated_at, deleted'

/** One catalog problem queued inside a collaboration session. */
export interface QueueItem {
  id: string
  sessionId: string
  sourceCatalogId: string
  boardLayoutId: number
  addedBy: string | null
  position: number
  doneAt: string | null
  doneBy: string | null
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export function fromQueueRow(r: QueueItemRow): QueueItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    sourceCatalogId: r.source_catalog_id,
    boardLayoutId: r.board_layout_id,
    addedBy: r.added_by,
    position: r.position,
    doneAt: r.done_at,
    doneBy: r.done_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted,
  }
}

/**
 * Deterministic total order for ACTIVE rows: `position, created_at, id` (KTD3). The
 * created_at + id tiebreak is load-bearing — an interleaved add writes `max(position)+1`
 * outside the reorder transaction and can momentarily collide with a renumbered row, so
 * without the tiebreak two clients could render a different order for the same data,
 * violating AE3. Mirrors the migration's `ORDER BY position, created_at, id`.
 */
export function compareActiveItems(a: QueueItem, b: QueueItem): number {
  if (a.position !== b.position) return a.position - b.position
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Deterministic order for the DONE group: by `done_at` (then `id`), oldest check-off first. */
export function compareDoneItems(a: QueueItem, b: QueueItem): number {
  const ad = a.doneAt ?? ''
  const bd = b.doneAt ?? ''
  if (ad !== bd) return ad < bd ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
