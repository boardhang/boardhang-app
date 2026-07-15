import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueItemRow } from './queueTypes'

// ── Stateful supabase mock: a tiny server modeling the session_queue RLS + the reorder RPC,
//    including the active-only partial-unique index (session_id, source_catalog_id) that raises
//    23505 on a second ACTIVE row for the same problem. ──
const h = vi.hoisted(() => ({
  userId: 'user-A' as string | null,
  rows: [] as QueueItemRow[],
  seq: 0,
  tick: 0, // monotonic created_at source for inserts
  clientNull: false,
  failReorder: false,
  failUpdate: false, // generic (non-23505) update failure — exercises rollback paths
  selectCount: 0,
}))

/** Does an ACTIVE row already exist for this problem (the partial-unique key), excluding `id`? */
function activeDupExists(sessionId: string, catalogId: string, exceptId?: string): boolean {
  return h.rows.some(
    (r) =>
      r.id !== exceptId &&
      !r.deleted &&
      r.done_at === null &&
      r.session_id === sessionId &&
      r.source_catalog_id === catalogId,
  )
}

vi.mock('../supabase/client', () => {
  function resolveQuery(table: string, steps: [string, ...unknown[]][]): { data: unknown; error: unknown } {
    if (table !== 'session_queue') return { data: null, error: null }
    const verb = steps.find((s) => ['insert', 'update'].includes(s[0]))?.[0] ?? 'select'
    const now = new Date().toISOString()

    if (verb === 'insert') {
      const p = steps.find((s) => s[0] === 'insert')![1] as Record<string, unknown>
      if (activeDupExists(p.session_id as string, p.source_catalog_id as string)) {
        return { data: null, error: { code: '23505', message: 'unique_violation' } }
      }
      const id = `q-${++h.seq}`
      const row: QueueItemRow = {
        id,
        session_id: p.session_id as string,
        source_catalog_id: p.source_catalog_id as string,
        board_layout_id: (p.board_layout_id as number) ?? 7,
        added_by: (p.added_by as string) ?? null,
        position: (p.position as number) ?? 0,
        done_at: null,
        done_by: null,
        created_at: new Date(1_700_000_000_000 + ++h.tick).toISOString(),
        updated_at: now,
        deleted: false,
      }
      h.rows.push(row)
      return { data: row, error: null }
    }

    if (verb === 'update') {
      const patch = steps.find((s) => s[0] === 'update')![1] as Record<string, unknown>
      const id = steps.find((s) => s[0] === 'eq')?.[2] as string
      const row = h.rows.find((r) => r.id === id)
      if (!row) return { data: null, error: null }
      // Un-check into an already-active problem violates the active-only partial-unique index.
      if (patch.done_at === null && activeDupExists(row.session_id, row.source_catalog_id, id)) {
        return { data: null, error: { code: '23505', message: 'unique_violation' } }
      }
      if (h.failUpdate) return { data: null, error: { message: 'boom' } }
      Object.assign(row, patch, { updated_at: now })
      return { data: null, error: null }
    }

    // select
    h.selectCount += 1
    const sid = steps.find((s) => s[0] === 'eq' && s[1] === 'session_id')?.[2] as string
    const rows = h.rows.filter((r) => r.session_id === sid && !r.deleted)
    return { data: rows, error: null }
  }

  function makeBuilder(table: string) {
    const steps: [string, ...unknown[]][] = []
    const b: Record<string, unknown> = {}
    for (const m of ['insert', 'update', 'select', 'eq', 'order', 'single']) {
      b[m] = (...args: unknown[]) => {
        steps.push([m, ...args])
        return b
      }
    }
    b.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      try {
        res(resolveQuery(table, steps))
      } catch (e) {
        rej?.(e)
      }
    }
    return b
  }

  function rpc(name: string, _args: Record<string, unknown>) {
    const run = (): { data: unknown; error: unknown } => {
      if (name === 'reorder_session_queue') {
        if (h.failReorder) return { data: null, error: { message: 'reorder failed' } }
        const ids = (_args.p_ordered_ids as string[]) ?? []
        ids.forEach((id, idx) => {
          const row = h.rows.find((r) => r.id === id && !r.deleted && r.done_at === null)
          if (row) row.position = idx + 1
        })
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }
    return { then: (res: (v: unknown) => void) => res(run()) }
  }

  const client = {
    from: (t: string) => makeBuilder(t),
    rpc,
    auth: {
      getSession: async () => ({ data: { session: h.userId ? { user: { id: h.userId } } : null } }),
    },
  }
  return {
    get supabase() {
      return h.clientNull ? null : client
    },
    isConfigured: true,
  }
})

import {
  activateQueue,
  addProblem,
  checkOff,
  clearQueue,
  getQueueSnapshot,
  refreshQueue,
  removeItem,
  reorder,
  unCheck,
} from './queueStore'

const SID = 'session-1'

/** Seed a server row directly (bypasses the client), then reflect it into the store via a fetch. */
function seedRow(over: Partial<QueueItemRow>): QueueItemRow {
  const row: QueueItemRow = {
    id: over.id ?? `seed-${++h.seq}`,
    session_id: over.session_id ?? SID,
    source_catalog_id: over.source_catalog_id ?? 'cat-x',
    board_layout_id: over.board_layout_id ?? 7,
    added_by: over.added_by ?? 'user-A',
    position: over.position ?? 1,
    done_at: over.done_at ?? null,
    done_by: over.done_by ?? null,
    created_at: over.created_at ?? new Date(1_700_000_000_000 + ++h.tick).toISOString(),
    updated_at: over.updated_at ?? new Date().toISOString(),
    deleted: over.deleted ?? false,
  }
  h.rows.push(row)
  return row
}

/** Activate the session and let the initial fetch settle. */
async function activateAndLoad(): Promise<void> {
  activateQueue(SID)
  await Promise.resolve()
  await Promise.resolve()
}

const snap = () => getQueueSnapshot()

beforeEach(() => {
  h.userId = 'user-A'
  h.rows = []
  h.seq = 0
  h.tick = 0
  h.clientNull = false
  h.failReorder = false
  h.failUpdate = false
  h.selectCount = 0
  clearQueue() // reset in-memory module state + stop listeners
})

afterEach(() => {
  clearQueue()
})

describe('addProblem (R2 / R5)', () => {
  it('appends the new problem at the end of the active order', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    await activateAndLoad()

    const result = await addProblem('cat-2', 7)

    expect(result).toBe('ok')
    const ids = snap().activeItems.map((i) => i.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('a')
    const added = snap().activeItems[1]
    expect(added.sourceCatalogId).toBe('cat-2')
    expect(added.position).toBe(2) // max(1) + 1
  })

  it('resolves a concurrent duplicate active add to a single row without throwing', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    await activateAndLoad()

    // A second active add for the same problem hits the active-only partial-unique 23505.
    const result = await addProblem('cat-1', 7)

    expect(result).toBe('already-active')
    const forCat1 = snap().activeItems.filter((i) => i.sourceCatalogId === 'cat-1')
    expect(forCat1).toHaveLength(1) // optimistic row rolled back; reconciled to the single server row
  })
})

describe('checkOff / unCheck (R6 / R8 / AE2)', () => {
  it('checkOff moves an item from active to done; unCheck returns it to the end of active', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    seedRow({ id: 'b', source_catalog_id: 'cat-2', position: 2 })
    await activateAndLoad()

    await checkOff('a')
    expect(snap().activeItems.map((i) => i.id)).toEqual(['b'])
    expect(snap().doneItems.map((i) => i.id)).toEqual(['a'])

    const result = await unCheck('a')
    expect(result).toBe('ok')
    // Returns to active at the END (position = max + 1).
    expect(snap().activeItems.map((i) => i.id)).toEqual(['b', 'a'])
    expect(snap().doneItems).toHaveLength(0)
    expect(snap().activeItems.find((i) => i.id === 'a')!.position).toBe(3)
  })

  it('unCheck while an active duplicate exists is a clean no-op with "already-active" (KTD2 / AE5)', async () => {
    // AE5 state: cat-1 is Done AND was re-added, so it is already active under a fresh id.
    const done = seedRow({ id: 'done-1', source_catalog_id: 'cat-1', position: 1, done_at: new Date().toISOString() })
    seedRow({ id: 'active-1', source_catalog_id: 'cat-1', position: 2 }) // the fresh active row
    await activateAndLoad()
    expect(snap().doneItems.map((i) => i.id)).toEqual(['done-1'])

    const result = await unCheck(done.id)

    expect(result).toBe('already-active') // NOT a raw 23505 throw
    // The Done row stays done; the active row is unchanged (still exactly one active cat-1).
    expect(snap().doneItems.map((i) => i.id)).toEqual(['done-1'])
    expect(snap().activeItems.filter((i) => i.sourceCatalogId === 'cat-1').map((i) => i.id)).toEqual(['active-1'])
  })
})

describe('removeItem (R4)', () => {
  it('soft-deletes and drops the item from both groups', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    seedRow({ id: 'b', source_catalog_id: 'cat-2', position: 2 })
    await activateAndLoad()

    await removeItem('a')

    expect(snap().activeItems.map((i) => i.id)).toEqual(['b'])
    expect(h.rows.find((r) => r.id === 'a')!.deleted).toBe(true)
  })

  it('rolls back the optimistic removal on a failed write', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    await activateAndLoad()
    h.failUpdate = true

    await expect(removeItem('a')).rejects.toThrow('boom')
    expect(snap().activeItems.map((i) => i.id)).toEqual(['a']) // restored
  })
})

describe('reorder (R3 / AE3)', () => {
  it('optimistically applies the new order and persists it via the RPC', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    seedRow({ id: 'b', source_catalog_id: 'cat-2', position: 2 })
    seedRow({ id: 'c', source_catalog_id: 'cat-3', position: 3 })
    await activateAndLoad()

    await reorder(['c', 'a', 'b'])

    expect(snap().activeItems.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(h.rows.find((r) => r.id === 'c')!.position).toBe(1)
  })

  it('rolls back to the server order on an RPC error', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    seedRow({ id: 'b', source_catalog_id: 'cat-2', position: 2 })
    seedRow({ id: 'c', source_catalog_id: 'cat-3', position: 3 })
    await activateAndLoad()
    h.failReorder = true

    await expect(reorder(['c', 'b', 'a'])).rejects.toThrow('reorder failed')
    expect(snap().activeItems.map((i) => i.id)).toEqual(['a', 'b', 'c']) // rolled back to server order
  })
})

describe('deterministic order (R3 / AE3 tiebreak)', () => {
  it('sorts two items with a colliding position identically by (created_at, id) on repeated fetch', async () => {
    // Same position; created_at deliberately opposite to id lexical order so only the created_at
    // tiebreak (not incidental array/id order) can produce a stable, correct result.
    seedRow({ id: 'zzz', source_catalog_id: 'cat-1', position: 5, created_at: '2026-01-01T00:00:00.000Z' })
    seedRow({ id: 'aaa', source_catalog_id: 'cat-2', position: 5, created_at: '2026-02-01T00:00:00.000Z' })

    await activateAndLoad()
    const first = snap().activeItems.map((i) => i.id)
    expect(first).toEqual(['zzz', 'aaa']) // earlier created_at first, despite id order

    // Reverse the server's return order and refetch — the client sort makes the result identical.
    h.rows.reverse()
    refreshQueue()
    await vi.waitFor(() => expect(h.selectCount).toBeGreaterThan(1))
    await Promise.resolve()
    expect(snap().activeItems.map((i) => i.id)).toEqual(first)
  })
})

describe('reconcile triggers (R10 / KTD5)', () => {
  it('refreshQueue refetches on visibilitychange → visible', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1 })
    await activateAndLoad()
    const before = h.selectCount

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.waitFor(() => expect(h.selectCount).toBeGreaterThan(before))
  })

  it('refetches on active-session change (activateQueue)', async () => {
    seedRow({ id: 'a', source_catalog_id: 'cat-1', position: 1, session_id: 'session-2' })
    activateQueue('session-2')
    await vi.waitFor(() => expect(h.selectCount).toBeGreaterThan(0))
    expect(snap().activeItems.map((i) => i.id)).toEqual(['a'])
  })
})
