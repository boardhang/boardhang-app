import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListProblemRow, ListRow } from './listsTypes'
import {
  cacheListProblems,
  cacheLists,
  clearListsCache,
  countListProblems,
  readListProblems,
  readLists,
  syncLists,
} from './listsSync'

// A configurable supabase whose `.order()` resolves to a per-table queued response.
const h = vi.hoisted(() => ({
  tableResponses: {} as Record<string, { data: unknown[] | null; error: unknown }>,
}))

vi.mock('../supabase/client', () => {
  const makeBuilder = (table: string) => {
    const builder = {
      select: () => builder,
      gt: () => builder,
      order: () => Promise.resolve(h.tableResponses[table] ?? { data: [], error: null }),
    }
    return builder
  }
  return { supabase: { from: (t: string) => makeBuilder(t) }, isConfigured: true }
})

const LISTS_CURSOR = 'listsCursor'
const PROBLEMS_CURSOR = 'listProblemsCursor'

function listRow(id: string, updatedAt: string, overrides: Partial<ListRow> = {}): ListRow {
  return {
    id,
    owner_id: 'user-1',
    name: `List ${id}`,
    board_layout_id: 7,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted: false,
    ...overrides,
  }
}

function problemRow(
  id: string,
  listId: string,
  updatedAt: string,
  overrides: Partial<ListProblemRow> = {},
): ListProblemRow {
  return {
    id,
    list_id: listId,
    source_catalog_id: `cat-${id}`,
    board_layout_id: 7,
    added_by: 'user-1',
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted: false,
    ...overrides,
  }
}

function setResponse(table: string, rows: ListRow[] | ListProblemRow[]) {
  h.tableResponses[table] = { data: rows, error: null }
}

beforeEach(() => {
  // Fresh IndexedDB + cursors per test.
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  h.tableResponses = {}
})

describe('syncLists — high-water pull', () => {
  it('cold cache: applies rows, advances both cursors, readLists returns them', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z'), listRow('b', '2026-07-06T02:00:00Z')])
    setResponse('list_problems', [problemRow('p1', 'a', '2026-07-06T01:30:00Z')])

    const { synced } = await syncLists('user-1')
    expect(synced).toBe(true)

    const lists = await readLists()
    expect(lists.map((l) => l.id).sort()).toEqual(['a', 'b'])
    expect(localStorage.getItem(LISTS_CURSOR)).toBe('2026-07-06T02:00:00Z')
    expect(localStorage.getItem(PROBLEMS_CURSOR)).toBe('2026-07-06T01:30:00Z')
  })

  it('incremental: a newer row updates only that row and moves the cursor', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z')])
    await syncLists('user-1')

    setResponse('lists', [listRow('a', '2026-07-06T05:00:00Z', { name: 'Renamed' })])
    await syncLists('user-1')

    const lists = await readLists()
    expect(lists).toHaveLength(1)
    expect(lists[0].name).toBe('Renamed')
    expect(localStorage.getItem(LISTS_CURSOR)).toBe('2026-07-06T05:00:00Z')
  })

  it('tombstone: a deleted:true row is removed from the store', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z'), listRow('b', '2026-07-06T01:00:00Z')])
    await syncLists('user-1')

    setResponse('lists', [listRow('a', '2026-07-06T03:00:00Z', { deleted: true })])
    await syncLists('user-1')

    const lists = await readLists()
    expect(lists.map((l) => l.id)).toEqual(['b'])
  })

  it('empty delta: cursor unchanged and cache intact', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z')])
    await syncLists('user-1')
    const cursorBefore = localStorage.getItem(LISTS_CURSOR)

    setResponse('lists', [])
    const { synced } = await syncLists('user-1')

    expect(synced).toBe(true)
    expect(localStorage.getItem(LISTS_CURSOR)).toBe(cursorBefore)
    expect(await readLists()).toHaveLength(1)
  })

  it('readListProblems returns only that list live problems (index scoped)', async () => {
    setResponse('list_problems', [
      problemRow('p1', 'a', '2026-07-06T01:00:00Z'),
      problemRow('p2', 'a', '2026-07-06T01:00:00Z'),
      problemRow('p3', 'b', '2026-07-06T01:00:00Z'),
    ])
    await syncLists('user-1')

    const forA = await readListProblems('a')
    expect(forA.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    const forB = await readListProblems('b')
    expect(forB.map((p) => p.id)).toEqual(['p3'])
  })

  it('supabase error mid-pull: cursor not advanced, prior cache readable, synced false', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z')])
    await syncLists('user-1')
    const cursorBefore = localStorage.getItem(LISTS_CURSOR)

    h.tableResponses.lists = { data: null, error: { message: 'network down' } }
    const { synced } = await syncLists('user-1')

    expect(synced).toBe(false)
    expect(localStorage.getItem(LISTS_CURSOR)).toBe(cursorBefore)
    expect((await readLists()).map((l) => l.id)).toEqual(['a'])
  })
})

describe('cache write-through', () => {
  it('cacheLists puts a live row and deletes a tombstoned one', async () => {
    await cacheLists([listRow('a', '2026-07-06T01:00:00Z')])
    expect((await readLists()).map((l) => l.id)).toEqual(['a'])

    await cacheLists([listRow('a', '2026-07-06T02:00:00Z', { deleted: true })])
    expect(await readLists()).toHaveLength(0)
  })

  it('cacheListProblems feeds countListProblems', async () => {
    await cacheListProblems([
      problemRow('p1', 'a', '2026-07-06T01:00:00Z'),
      problemRow('p2', 'a', '2026-07-06T01:00:00Z'),
      problemRow('p3', 'b', '2026-07-06T01:00:00Z'),
    ])
    const counts = await countListProblems()
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
  })
})

describe('clearListsCache', () => {
  it('empties both stores and clears both cursors', async () => {
    setResponse('lists', [listRow('a', '2026-07-06T01:00:00Z')])
    setResponse('list_problems', [problemRow('p1', 'a', '2026-07-06T01:00:00Z')])
    await syncLists('user-1')

    await clearListsCache()

    expect(await readLists()).toHaveLength(0)
    expect(await readListProblems('a')).toHaveLength(0)
    expect(localStorage.getItem(LISTS_CURSOR)).toBeNull()
    expect(localStorage.getItem(PROBLEMS_CURSOR)).toBeNull()
  })
})
