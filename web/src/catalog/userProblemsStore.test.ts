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
  selectFilters: [] as Array<[string, unknown]>,
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

  // Selects here are only pulls — the identity hook's, the warm-cache background delta, the
  // public snapshot. Nothing in these tests depends on their rows, so an empty page
  // terminates them immediately; their filters are recorded so a test can tell the own-rows
  // delta (`user_id`) from the per-slab snapshot (`visibility`).
  for (const step of steps) {
    if (step.m === 'eq') h.selectFilters.push(step.args as [string, unknown])
  }
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
  // 0019's attribution columns are stamped by trigger from auth.uid() and the caller's
  // profile (KTD7). A client that sent them would be trying to publish under someone else's
  // name, so the fake refuses them the way the trigger's re-stamp effectively does.
  if ('setter_user_id' in payload || 'setter_handle' in payload) {
    return { data: null, error: { message: 'setter attribution is trigger-owned' } }
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

import { countSlab } from './catalogSync'
import { getFavoriteIds, toggleFavorite } from './favoritesStore'
import { EMPTY_DRAFT, readDraft, readSaveIntent, writeDraft, writeSaveIntent } from './problemDraftStore'
import { getRecentIds, recordRecent } from './recentsStore'
import {
  cacheUserProblems,
  currentCacheGeneration,
  getUserProblemsByIds,
  readCachedUserId,
  readUserProblemsForSlab,
  setCachedUserId,
} from './userProblemsSync'
import {
  createUserProblem,
  deleteUserProblem,
  evictUserProblems,
  loadUserProblems,
  setUserProblemVisibility,
  subscribeUserProblemsChanged,
  syncPublicUserProblems,
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
    setter_user_id: null,
    setter_handle: null,
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
  h.selectFilters = []
})

describe('loadUserProblems', () => {
  it('paints a warm cache immediately and still pulls the own-rows delta behind it', async () => {
    // Without the background pull a problem authored on another device never arrives: the
    // cursor short-circuits every load, and only a sign-out/in would re-pull.
    localStorage.setItem('userProblemsCursor', '2026-01-01T00:00:00+00:00')

    const { synced } = await loadUserProblems()

    expect(synced).toBe(true)
    await vi.waitFor(() => expect(h.selectFilters).toContainEqual(['user_id', 'user-A']))
  })

  it('reports "nothing to pull" rather than a failure when signed out', async () => {
    // useSlab folds this into the same degraded flag the catalog sync uses, so a signed-out
    // visitor must not read as offline.
    h.session = null
    expect(await loadUserProblems()).toEqual({ synced: true })
    expect(h.selectFilters).toEqual([])
  })
})

describe('createUserProblem', () => {
  it('caches the row under its generated id, and nowhere near the catalog cache', async () => {
    const saved = await createUserProblem(newProblem())

    expect(saved.sourceCatalogId).toBe(`user:${saved.id}`)
    const cached = await getUserProblemsByIds([saved.sourceCatalogId])
    expect(cached.get(saved.sourceCatalogId)?.name).toBe('Crimp Ladder')
    // Separate IndexedDB database (KTD3): the catalog's `problems` store is untouched, so
    // Settings → "Rebuild catalog" can never destroy an authored problem. Counted rather
    // than read, because readSlab merges the two databases and would report the row.
    expect(await countSlab(LAYOUT, ANGLE)).toBe(0)
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

  it('drops an eviction whose captured generation is stale', async () => {
    // The snapshot decides what to evict before the identity switch and applies it after;
    // the id it resolved belongs to the previous user's view of the cache, so the write —
    // and the recents/favorites pruning that rides with it — has to be dropped whole.
    await cacheUserProblems([cachedRow('gone', { user_id: 'user-B', visibility: 'public' })])
    recordRecent(LAYOUT, ANGLE, 'user:gone')
    const gen = currentCacheGeneration()

    await syncUserProblemsIdentity('user-B')
    await evictUserProblems(['user:gone'], gen)

    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual(['gone'])
    expect(getRecentIds(LAYOUT, ANGLE)).toEqual(['user:gone'])
  })
})

describe('syncPublicUserProblems', () => {
  it('evicts a retracted public row, prunes its dangling ids, and repaints the list', async () => {
    // The fake serves an empty snapshot, i.e. user B retracted everything they had published.
    await cacheUserProblems([cachedRow('gone', { user_id: 'user-B', visibility: 'public' })])
    recordRecent(LAYOUT, ANGLE, 'user:gone')
    toggleFavorite('user:gone')
    const seen = vi.fn()
    subscribeUserProblemsChanged(seen)

    const { synced } = await syncPublicUserProblems(LAYOUT, ANGLE)

    expect(synced).toBe(true)
    expect(await readUserProblemsForSlab(LAYOUT, ANGLE)).toEqual([])
    expect(getRecentIds(LAYOUT, ANGLE)).toEqual([])
    expect(getFavoriteIds().has('user:gone')).toBe(false)
    // The eviction has to reach a mounted catalog list — nothing else tells it the row went.
    expect(seen).toHaveBeenCalled()
    // Local only: a snapshot never writes back.
    expect(h.writePayloads).toEqual([])
  })

  it('keeps the signed-in user’s own rows, which the public snapshot never lists', async () => {
    await cacheUserProblems([cachedRow('mine'), cachedRow('theirs', { user_id: 'user-B' })])

    await syncPublicUserProblems(LAYOUT, ANGLE)

    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual(['mine'])
  })
})

describe('publish rejections', () => {
  // 0019 enforces the publish rules with plpgsql `raise exception`, which reaches the client
  // as the raw postgres message. These assert the store turns each into copy an author can
  // act on — keyed on a stable fragment, not the whole sentence.
  it('explains a missing profile handle', async () => {
    const saved = await createUserProblem(newProblem())
    h.errorOn.add('user_problems.update')
    h.errorMessage =
      'Pick a profile handle before publishing a problem — a public problem is credited to its setter.'

    await expect(setUserProblemVisibility(saved.sourceCatalogId, 'public')).rejects.toThrow(
      /profile handle/i,
    )
  })

  it('explains the public cap without leaking the postgres wording', async () => {
    const saved = await createUserProblem(newProblem())
    h.errorOn.add('user_problems.update')
    h.errorMessage =
      'Public problem limit reached: 50 already published (max 50). Make one private or delete it before publishing another.'

    await expect(setUserProblemVisibility(saved.sourceCatalogId, 'public')).rejects.toThrow(
      /make one private or delete one/i,
    )
  })

  it('explains a rejected public row instead of quoting the check constraint', async () => {
    h.errorOn.add('user_problems.insert')
    h.errorMessage =
      'new row for relation "user_problems" violates check constraint "user_problems_public_complete"'

    // Both bounds named: "a valid set of holds" left an author guessing what invalidated
    // theirs, and 0019 caps the array at 60 (and rejects an empty one).
    await expect(createUserProblem(newProblem({ visibility: 'public' }))).rejects.toThrow(
      /60 characters or fewer.*between 1 and 60 holds/i,
    )
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

  it('sweeps private rows on sign-out even when the gate says the cache is already clean', async () => {
    // The multi-tab race: another tab cleared the gate first, so this tab's own sign-out
    // handler sees prev === next and used to return before doing anything — while its own
    // in-flight delta page had already written the previous user's private rows back.
    await setCachedUserId('')
    await cacheUserProblems([
      cachedRow('mine'),
      cachedRow('theirs', { user_id: 'user-B', visibility: 'public' }),
    ])
    const seen = vi.fn()
    subscribeUserProblemsChanged(seen)

    await syncUserProblemsIdentity(null)

    expect((await readUserProblemsForSlab(LAYOUT, ANGLE)).map((p) => p.id)).toEqual(['theirs'])
    // Nothing else on this path tells a mounted list the rows went.
    expect(seen).toHaveBeenCalled()
  })
})

describe('drafts across an identity change', () => {
  const DRAFT = { holds: [{ c: 1, r: 2, t: 'start' as const }], name: 'Parked', grade: '6B', visibility: 'private' as const }

  it('drops a parked draft and its save intent when the user departs', async () => {
    await setCachedUserId('user-A')
    writeDraft(LAYOUT, ANGLE, DRAFT)
    writeSaveIntent(LAYOUT, ANGLE, true)

    await syncUserProblemsIdentity('user-B')

    // Otherwise the drawer's resume effect reopens user A's save sheet for user B.
    expect(readDraft(LAYOUT, ANGLE)).toEqual(EMPTY_DRAFT)
    expect(readSaveIntent(LAYOUT, ANGLE)).toBe(false)
  })

  it('drops them on sign-out too', async () => {
    await setCachedUserId('user-A')
    writeDraft(LAYOUT, ANGLE, DRAFT)
    writeSaveIntent(LAYOUT, ANGLE, true)

    await syncUserProblemsIdentity(null)

    expect(readDraft(LAYOUT, ANGLE)).toEqual(EMPTY_DRAFT)
    expect(readSaveIntent(LAYOUT, ANGLE)).toBe(false)
  })

  it('keeps the draft a signed-out author parked before signing in (AE1)', async () => {
    // The whole point of persisting the draft: Save signed out opens the sign-in dialog, and
    // Google OAuth takes the page away. That '' → user transition must never clear it.
    writeDraft(LAYOUT, ANGLE, DRAFT)
    writeSaveIntent(LAYOUT, ANGLE, true)

    await syncUserProblemsIdentity('user-A')

    expect(readDraft(LAYOUT, ANGLE)).toEqual(DRAFT)
    expect(readSaveIntent(LAYOUT, ANGLE)).toBe(true)
  })
})
