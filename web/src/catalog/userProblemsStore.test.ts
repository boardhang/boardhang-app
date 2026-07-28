import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserProblemRow } from './userProblemsTypes'

// ── A small stateful fake of the user_problems table. ───────────────────────────
// It mirrors the two server-owned columns the client must never write: `updated_at`
// (trigger-stamped) and the GENERATED `source_catalog_id`. A payload carrying either is
// rejected the way PostgREST would, so "never write the generated column" is asserted by
// every insert/update in this file rather than only where a test says so.
interface Step {
  m: string
  args: unknown[]
}

const h = vi.hoisted(() => ({
  session: { user: { id: 'user-A' } } as { user: { id: string } } | null,
  rows: [] as Record<string, unknown>[],
  errorOn: new Set<string>(),
  errorMessage: 'boom',
  clock: 0,
  writePayloads: [] as Record<string, unknown>[],
}))

function stamp(): string {
  h.clock += 1
  return `2026-01-01T00:00:${String(h.clock).padStart(2, '0')}+00:00`
}

function resolve(table: string, steps: Step[]): { data: unknown; error: unknown } {
  const insert = steps.find((s) => s.m === 'insert')
  const update = steps.find((s) => s.m === 'update')
  const verb = insert ? 'insert' : update ? 'update' : 'select'
  if (h.errorOn.has(`${table}.${verb}`)) {
    return { data: null, error: { message: h.errorMessage } }
  }

  if (insert) {
    const payload = { ...(insert.args[0] as Record<string, unknown>) }
    h.writePayloads.push(payload)
    const rejection = rejectServerOwnedColumns(payload)
    if (rejection) return rejection
    const row = {
      ...payload,
      source_catalog_id: `user:${String(payload.id)}`,
      updated_at: stamp(),
      deleted: false,
    }
    h.rows.push(row)
    return { data: row, error: null }
  }

  if (update) {
    const payload = { ...(update.args[0] as Record<string, unknown>) }
    h.writePayloads.push(payload)
    const rejection = rejectServerOwnedColumns(payload)
    if (rejection) return rejection
    const id = steps.find((s) => s.m === 'eq' && s.args[0] === 'id')?.args[1]
    const matched = h.rows.filter((r) => r.id === id)
    for (const r of matched) Object.assign(r, payload, { updated_at: stamp() })
    return { data: matched[0] ?? null, error: null }
  }

  // Selects here are only the identity-hook's delta pull; nothing in these tests depends on
  // its rows, so an empty page terminates it immediately.
  return { data: [], error: null }
}

function rejectServerOwnedColumns(
  payload: Record<string, unknown>,
): { data: null; error: { message: string } } | null {
  if ('source_catalog_id' in payload) {
    return { data: null, error: { message: 'cannot insert into generated column' } }
  }
  if ('updated_at' in payload) {
    return { data: null, error: { message: 'updated_at is trigger-owned' } }
  }
  return null
}

function makeBuilder(table: string) {
  const steps: Step[] = []
  const builder = {
    then(
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      return Promise.resolve(resolve(table, steps)).then(onFulfilled, onRejected)
    },
  } as Record<string, unknown>
  for (const m of ['select', 'insert', 'update', 'eq', 'gte', 'order', 'range', 'limit', 'single']) {
    builder[m] = (...args: unknown[]) => {
      steps.push({ m, args })
      return builder
    }
  }
  return builder
}

vi.mock('../supabase/client', () => ({
  isConfigured: true,
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: h.session } }) },
    from: (table: string) => makeBuilder(table),
  },
}))

import { readSlab } from './catalogSync'
import { getFavoriteIds, toggleFavorite } from './favoritesStore'
import { getRecentIds, recordRecent } from './recentsStore'
import {
  cacheUserProblems,
  getUserProblemsByIds,
  readCachedUserId,
  readUserProblemsForSlab,
  setCachedUserId,
} from './userProblemsSync'
import {
  createUserProblem,
  deleteUserProblem,
  evictUserProblems,
  setUserProblemVisibility,
  subscribeUserProblemsChanged,
  syncUserProblemsIdentity,
  updateUserProblem,
} from './userProblemsStore'

const LAYOUT = 7
const ANGLE = 40

function newProblem(overrides: Partial<Parameters<typeof createUserProblem>[0]> = {}) {
  return {
    layoutId: LAYOUT,
    angle: ANGLE,
    name: 'Crimp Ladder',
    grade: '6C',
    holds: [{ c: 3, r: 4, t: 'start' as const }],
    ...overrides,
  }
}

function cachedRow(id: string, overrides: Partial<UserProblemRow> = {}): UserProblemRow {
  return {
    id,
    user_id: 'user-A',
    name: `Problem ${id}`,
    grade: '6B',
    holds: [],
    layout_id: LAYOUT,
    angle: ANGLE,
    visibility: 'private',
    source_catalog_id: `user:${id}`,
    updated_at: '2026-01-01T00:00:00+00:00',
    deleted: false,
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  h.session = { user: { id: 'user-A' } }
  h.rows = []
  h.errorOn = new Set()
  h.errorMessage = 'boom'
  h.clock = 0
  h.writePayloads = []
})

describe('createUserProblem', () => {
  it('caches the row under its generated id, and nowhere near the catalog cache', async () => {
    const saved = await createUserProblem(newProblem())

    expect(saved.sourceCatalogId).toBe(`user:${saved.id}`)
    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.name).toBe('Crimp Ladder')
    // Separate IndexedDB database (KTD3): the catalog's `problems` store is untouched, so
    // Settings → "Rebuild catalog" can never destroy an authored problem.
    expect(await readSlab(LAYOUT, ANGLE)).toEqual([])
    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual([saved.id])
  })

  it('never sends the generated id or the trigger-stamped timestamp', async () => {
    const saved = await createUserProblem(newProblem())
    expect(h.writePayloads[0]).not.toHaveProperty('source_catalog_id')
    expect(h.writePayloads[0]).not.toHaveProperty('updated_at')
    // The server-stamped updated_at is what lands in the cache, not our provisional one.
    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.updatedAt).toBe('2026-01-01T00:00:01+00:00')
  })

  it('defaults to private and stores an explicit visibility', async () => {
    const priv = await createUserProblem(newProblem())
    expect(priv.visibility).toBe('private')
    const pub = await createUserProblem(newProblem({ visibility: 'public' }))
    expect(pub.visibility).toBe('public')
  })

  it('refuses to save signed out', async () => {
    h.session = null
    await expect(createUserProblem(newProblem())).rejects.toThrow(/signed in/i)
  })

  it('rolls the optimistic row back out of the cache when the insert fails', async () => {
    h.errorOn.add('user_problems.insert')
    await expect(createUserProblem(newProblem())).rejects.toThrow('boom')
    expect(await readUserProblemsForSlab(LAYOUT, ANGLE)).toEqual([])
  })

  it('surfaces a dead network as an offline message, not a fetch error', async () => {
    h.errorOn.add('user_problems.insert')
    h.errorMessage = 'TypeError: Failed to fetch'
    await expect(createUserProblem(newProblem())).rejects.toThrow(/offline/i)
  })
})

describe('updateUserProblem / setUserProblemVisibility', () => {
  it('applies the edit and keeps the cache in step', async () => {
    const saved = await createUserProblem(newProblem())
    const updated = await updateUserProblem(saved.sourceCatalogId, { name: 'Renamed', grade: '7A' })
    expect(updated.name).toBe('Renamed')
    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.grade).toBe('7A')
  })

  it('restores the previous row when the update fails', async () => {
    const saved = await createUserProblem(newProblem())
    h.errorOn.add('user_problems.update')
    await expect(
      updateUserProblem(saved.sourceCatalogId, { name: 'Renamed' }),
    ).rejects.toThrow('boom')
    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.name).toBe('Crimp Ladder')
  })

  it('publishes without touching any other field', async () => {
    const saved = await createUserProblem(newProblem())
    const published = await setUserProblemVisibility(saved.sourceCatalogId, 'public')
    expect(published.visibility).toBe('public')
    expect(published.name).toBe('Crimp Ladder')
    expect(h.writePayloads.at(-1)).toEqual({ visibility: 'public' })
  })

  it('reports a problem that is not on this device instead of writing blind', async () => {
    await expect(updateUserProblem('user:nope', { name: 'x' })).rejects.toThrow(/on this device/i)
  })
})

describe('deleteUserProblem', () => {
  it('removes the row and prunes its id from recents and favorites', async () => {
    const saved = await createUserProblem(newProblem())
    recordRecent(LAYOUT, ANGLE, saved.sourceCatalogId)
    recordRecent(LAYOUT, ANGLE, 'catalog-other')
    toggleFavorite(saved.sourceCatalogId)

    await deleteUserProblem(saved.sourceCatalogId)

    expect(await readUserProblemsForSlab(LAYOUT, ANGLE)).toEqual([])
    // A dangling id would still occupy one of the five recents slots and still count
    // against the favorites filter.
    expect(getRecentIds(LAYOUT, ANGLE)).toEqual(['catalog-other'])
    expect(getFavoriteIds().has(saved.sourceCatalogId)).toBe(false)
  })

  it('keeps the row, the recent and the favorite when the server rejects the delete', async () => {
    const saved = await createUserProblem(newProblem())
    recordRecent(LAYOUT, ANGLE, saved.sourceCatalogId)
    toggleFavorite(saved.sourceCatalogId)
    h.errorOn.add('user_problems.update')

    await expect(deleteUserProblem(saved.sourceCatalogId)).rejects.toThrow('boom')

    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.name).toBe('Crimp Ladder')
    expect(getRecentIds(LAYOUT, ANGLE)).toEqual([saved.sourceCatalogId])
    expect(getFavoriteIds().has(saved.sourceCatalogId)).toBe(true)
  })
})

describe('evictUserProblems', () => {
  it('drops cached rows locally and forgets their dangling ids', async () => {
    await cacheUserProblems([cachedRow('gone', { user_id: 'user-B', visibility: 'public' })])
    recordRecent(LAYOUT, ANGLE, 'user:gone')
    toggleFavorite('user:gone')

    await evictUserProblems(['user:gone'])

    expect(await readUserProblemsForSlab(LAYOUT, ANGLE)).toEqual([])
    expect(getRecentIds(LAYOUT, ANGLE)).toEqual([])
    expect(getFavoriteIds().has('user:gone')).toBe(false)
    // Local only — nothing was written to the server.
    expect(h.writePayloads).toEqual([])
  })
})

describe('subscribeUserProblemsChanged', () => {
  it('fires exactly once per successful create, update and delete', async () => {
    const seen = vi.fn()
    const unsubscribe = subscribeUserProblemsChanged(seen)

    const saved = await createUserProblem(newProblem())
    expect(seen).toHaveBeenCalledTimes(1)

    await updateUserProblem(saved.sourceCatalogId, { name: 'Renamed' })
    expect(seen).toHaveBeenCalledTimes(2)

    await deleteUserProblem(saved.sourceCatalogId)
    expect(seen).toHaveBeenCalledTimes(3)

    unsubscribe()
    await createUserProblem(newProblem())
    expect(seen).toHaveBeenCalledTimes(3)
  })

  it('fires again on a rollback, because the row has to disappear', async () => {
    const seen = vi.fn()
    subscribeUserProblemsChanged(seen)
    h.errorOn.add('user_problems.insert')
    await expect(createUserProblem(newProblem())).rejects.toThrow()
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('syncUserProblemsIdentity', () => {
  it('clears the outgoing user’s own rows on sign-out but keeps a cached public row', async () => {
    await setCachedUserId('user-A')
    await cacheUserProblems([
      cachedRow('mine'),
      cachedRow('theirs', { user_id: 'user-B', visibility: 'public' }),
    ])

    await syncUserProblemsIdentity(null)

    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual(['theirs'])
    expect(await readCachedUserId()).toBe('')
  })

  it('leaves a warm cache alone when the same user’s session is restored', async () => {
    await setCachedUserId('user-A')
    await cacheUserProblems([cachedRow('mine')])

    await syncUserProblemsIdentity('user-A')

    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual(['mine'])
  })

  it('clears the previous user’s rows when a different user signs in', async () => {
    await setCachedUserId('user-A')
    await cacheUserProblems([cachedRow('mine')])

    await syncUserProblemsIdentity('user-B')

    expect(await readUserProblemsForSlab(LAYOUT, ANGLE)).toEqual([])
    expect(await readCachedUserId()).toBe('user-B')
  })
})
