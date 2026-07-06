import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListProblemRow, ListRow, SavedList, SavedListProblem } from './listsTypes'

// ── Mock the offline cache: vi.fn()s the store writes through / reads from. ──
vi.mock('./listsSync', () => ({
  readLists: vi.fn(),
  readListProblems: vi.fn(),
  syncLists: vi.fn(),
  hasListsCursor: vi.fn(),
  cacheLists: vi.fn(),
  cacheListProblems: vi.fn(),
  clearListsCache: vi.fn(),
  countListProblems: vi.fn(),
}))

// ── Mock supabase with a small stateful server modeling the RLS + partial index. ──
interface Step {
  m: string
  args: unknown[]
}
const h = vi.hoisted(() => ({
  session: { user: { id: 'user-A' } } as { user: { id: string } } | null,
  serverLists: [] as ListRow[],
  serverProblems: [] as ListProblemRow[],
  errorOn: new Set<string>(),
  listSeq: 0,
  problemSeq: 0,
}))

function opKey(table: string, steps: Step[]): string {
  const verb = steps.find((s) => s.m === 'insert')
    ? 'insert'
    : steps.find((s) => s.m === 'update')
      ? 'update'
      : 'select'
  return `${table}.${verb}`
}

function resolve(table: string, steps: Step[]): { data: unknown; error: unknown } {
  const key = opKey(table, steps)
  if (h.errorOn.has(key)) return { data: null, error: { message: 'boom' } }
  const now = new Date().toISOString()

  if (table === 'lists') {
    const insert = steps.find((s) => s.m === 'insert')
    if (insert) {
      const payload = insert.args[0] as Partial<ListRow>
      const row: ListRow = {
        id: `srv-list-${++h.listSeq}`,
        owner_id: payload.owner_id ?? '',
        name: payload.name ?? '',
        board_layout_id: payload.board_layout_id ?? 7,
        created_at: now,
        updated_at: now,
        deleted: false,
      }
      h.serverLists.push(row)
      return { data: row, error: null }
    }
    const update = steps.find((s) => s.m === 'update')!.args[0] as Partial<ListRow>
    const id = steps.find((s) => s.m === 'eq')?.args[1] as string
    const target = h.serverLists.find((r) => r.id === id)
    if (target) Object.assign(target, update)
    return { data: null, error: null }
  }

  // list_problems
  const match = steps.find((s) => s.m === 'match')?.args[0] as
    | { list_id: string; source_catalog_id: string }
    | undefined
  const insert = steps.find((s) => s.m === 'insert')
  if (insert) {
    const payload = insert.args[0] as Partial<ListProblemRow>
    // Partial unique index: a second LIVE row for the same key would violate it.
    const liveExists = h.serverProblems.some(
      (r) =>
        !r.deleted &&
        r.list_id === payload.list_id &&
        r.source_catalog_id === payload.source_catalog_id,
    )
    if (liveExists) return { data: null, error: { message: '23505 unique_violation' } }
    const row: ListProblemRow = {
      id: `srv-p-${++h.problemSeq}`,
      list_id: payload.list_id ?? '',
      source_catalog_id: payload.source_catalog_id ?? '',
      board_layout_id: payload.board_layout_id ?? 7,
      added_by: payload.added_by ?? null,
      created_at: now,
      updated_at: now,
      deleted: false,
    }
    h.serverProblems.push(row)
    return { data: row, error: null }
  }
  const update = steps.find((s) => s.m === 'update')!.args[0] as Partial<ListProblemRow>
  const matched = h.serverProblems.filter(
    (r) => match && r.list_id === match.list_id && r.source_catalog_id === match.source_catalog_id,
  )
  for (const r of matched) Object.assign(r, update, { updated_at: now })
  return { data: matched, error: null }
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
  for (const m of ['select', 'insert', 'update', 'eq', 'match', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      steps.push({ m, args })
      return builder
    }
  }
  builder.single = (...args: unknown[]) => {
    steps.push({ m: 'single', args })
    return builder
  }
  builder.maybeSingle = builder.single
  return builder
}

vi.mock('../supabase/client', () => ({
  isConfigured: true,
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: h.session } }) },
    from: (table: string) => makeBuilder(table),
  },
}))

import {
  addProblem,
  createList,
  deleteList,
  getListsSnapshot,
  loadLists,
  removeProblem,
  renameList,
  resetLists,
  syncListsIdentity,
} from './listsStore'
import {
  cacheListProblems,
  cacheLists,
  clearListsCache,
  hasListsCursor,
  readListProblems,
  readLists,
  syncLists,
} from './listsSync'

const readListsMock = vi.mocked(readLists)
const readListProblemsMock = vi.mocked(readListProblems)
const syncListsMock = vi.mocked(syncLists)
const hasListsCursorMock = vi.mocked(hasListsCursor)
const cacheListsMock = vi.mocked(cacheLists)
const cacheListProblemsMock = vi.mocked(cacheListProblems)
const clearListsCacheMock = vi.mocked(clearListsCache)

function savedList(id: string, name = `List ${id}`): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId: 7,
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

function listRow(id: string, name = `List ${id}`): ListRow {
  return {
    id,
    owner_id: 'user-A',
    name,
    board_layout_id: 7,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

function savedProblem(id: string, listId: string, catId: string): SavedListProblem {
  return {
    id,
    listId,
    sourceCatalogId: catId,
    boardLayoutId: 7,
    addedBy: 'user-A',
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

/** Populate the in-memory store by loading from a warm cache. */
async function seedStore(rows: SavedList[]): Promise<void> {
  hasListsCursorMock.mockReturnValue(true)
  readListsMock.mockResolvedValue(rows)
  await loadLists()
}

const state = () => getListsSnapshot()

beforeEach(async () => {
  h.session = { user: { id: 'user-A' } }
  h.serverLists = []
  h.serverProblems = []
  h.errorOn = new Set()
  h.listSeq = 0
  h.problemSeq = 0
  localStorage.clear()
  readListsMock.mockResolvedValue([])
  readListProblemsMock.mockResolvedValue([])
  syncListsMock.mockResolvedValue({ synced: true })
  hasListsCursorMock.mockReturnValue(true)
  cacheListsMock.mockResolvedValue(undefined)
  cacheListProblemsMock.mockResolvedValue(undefined)
  clearListsCacheMock.mockResolvedValue(undefined)
  await resetLists()
  vi.clearAllMocks()
  // clearAllMocks wipes call history but keeps implementations; re-assert the defaults
  // the store leans on so each test starts from a known cache.
  readListsMock.mockResolvedValue([])
  readListProblemsMock.mockResolvedValue([])
  syncListsMock.mockResolvedValue({ synced: true })
  hasListsCursorMock.mockReturnValue(true)
  cacheListsMock.mockResolvedValue(undefined)
  cacheListProblemsMock.mockResolvedValue(undefined)
  clearListsCacheMock.mockResolvedValue(undefined)
})

describe('loadLists', () => {
  it('cold cache triggers a sync and ends loaded with rows', async () => {
    hasListsCursorMock.mockReturnValue(false)
    readListsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([savedList('a')])
    syncListsMock.mockResolvedValue({ synced: true })

    await loadLists()

    expect(syncListsMock).toHaveBeenCalledWith('user-A')
    expect(state().status).toBe('loaded')
    expect(state().lists.map((l) => l.id)).toEqual(['a'])
  })

  it('warm cache paints cached rows without a network pull', async () => {
    hasListsCursorMock.mockReturnValue(true)
    readListsMock.mockResolvedValue([savedList('a'), savedList('b')])

    await loadLists()

    expect(syncListsMock).not.toHaveBeenCalled()
    expect(state().status).toBe('loaded')
    expect(state().lists).toHaveLength(2)
  })

  it('cold cache + failed pull + empty cache ends offline (not loaded/error)', async () => {
    hasListsCursorMock.mockReturnValue(false)
    readListsMock.mockResolvedValue([])
    syncListsMock.mockResolvedValue({ synced: false })

    await loadLists()

    expect(state().status).toBe('offline')
    expect(state().lists).toEqual([])
  })
})

describe('createList', () => {
  it('shows the optimistic list immediately, sets owner_id, reconciles the server id', async () => {
    await createList('Projects', 7)

    expect(h.serverLists).toHaveLength(1)
    expect(h.serverLists[0].owner_id).toBe('user-A')
    expect(state().lists).toHaveLength(1)
    expect(state().lists[0].id).toBe('srv-list-1')
    expect(state().lists[0].name).toBe('Projects')
    expect(cacheListsMock).toHaveBeenCalled()
  })

  it('rolls back the optimistic row and throws on a cloud error', async () => {
    await seedStore([savedList('existing')])
    h.errorOn.add('lists.insert')

    await expect(createList('Doomed', 7)).rejects.toThrow('boom')
    expect(state().lists.map((l) => l.id)).toEqual(['existing'])
  })
})

describe('renameList / deleteList', () => {
  it('renameList optimistically applies then persists', async () => {
    h.serverLists = [listRow('l1', 'Old')]
    await seedStore([savedList('l1', 'Old')])

    await renameList('l1', 'New')

    expect(state().lists[0].name).toBe('New')
    expect(h.serverLists[0].name).toBe('New')
  })

  it('renameList rolls back on error', async () => {
    await seedStore([savedList('l1', 'Old')])
    h.errorOn.add('lists.update')

    await expect(renameList('l1', 'New')).rejects.toThrow('boom')
    expect(state().lists[0].name).toBe('Old')
  })

  it('deleteList optimistically removes then persists', async () => {
    h.serverLists = [listRow('l1')]
    await seedStore([savedList('l1')])

    await deleteList('l1')

    expect(state().lists).toHaveLength(0)
    expect(h.serverLists[0].deleted).toBe(true)
  })

  it('deleteList rolls back on error', async () => {
    await seedStore([savedList('l1')])
    h.errorOn.add('lists.update')

    await expect(deleteList('l1')).rejects.toThrow('boom')
    expect(state().lists.map((l) => l.id)).toEqual(['l1'])
  })
})

describe('addProblem / removeProblem — explicit revive (KTD8)', () => {
  it('add sets added_by and inserts a new row when never added before', async () => {
    await addProblem('list-1', 'cat-1', 7)

    expect(h.serverProblems).toHaveLength(1)
    expect(h.serverProblems[0].added_by).toBe('user-A')
    expect(h.serverProblems[0].deleted).toBe(false)
  })

  it('add → remove → add yields exactly one LIVE row via revive (no second row)', async () => {
    await addProblem('list-1', 'cat-1', 7)
    readListProblemsMock.mockResolvedValue([savedProblem('opt', 'list-1', 'cat-1')])
    await removeProblem('list-1', 'cat-1')
    await addProblem('list-1', 'cat-1', 7)

    // A second insert would have thrown on the partial index; the revive reused the row.
    expect(h.serverProblems).toHaveLength(1)
    const live = h.serverProblems.filter((r) => !r.deleted)
    expect(live).toHaveLength(1)
    expect(live[0].added_by).toBe('user-A')
  })

  it('removeProblem rolls back (re-adds to cache) on error', async () => {
    readListProblemsMock.mockResolvedValue([savedProblem('p1', 'list-1', 'cat-1')])
    h.errorOn.add('list_problems.update')

    await expect(removeProblem('list-1', 'cat-1')).rejects.toThrow('boom')
    const restoreCall = cacheListProblemsMock.mock.calls.at(-1)?.[0] as ListProblemRow[]
    expect(restoreCall[0].deleted).toBe(false)
  })
})

describe('resetLists / cross-account (KTD-I9)', () => {
  it('resetLists empties the store and clears the cache', async () => {
    await seedStore([savedList('l1')])
    await resetLists()
    expect(state().lists).toEqual([])
    expect(state().status).toBe('idle')
    expect(clearListsCacheMock).toHaveBeenCalled()
  })

  it('sign out then in as a different user clears the cache and records the new id', async () => {
    localStorage.setItem('listsLastUserId', 'user-A')

    await syncListsIdentity(null)
    expect(clearListsCacheMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('listsLastUserId')).toBe('')

    await syncListsIdentity('user-B')
    expect(clearListsCacheMock).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('listsLastUserId')).toBe('user-B')
  })

  it('a restored same-user session does NOT clear the cache', async () => {
    localStorage.setItem('listsLastUserId', 'user-A')
    await syncListsIdentity('user-A')
    expect(clearListsCacheMock).not.toHaveBeenCalled()
  })
})
