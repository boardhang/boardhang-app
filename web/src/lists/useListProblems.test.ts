import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedListProblem } from './listsTypes'

// Capture the change-listener so the test can fire rapid notifies.
let listener: (() => void) | null = null
const refreshLists = vi.fn().mockResolvedValue({ synced: true })
vi.mock('./listsStore', () => ({
  refreshLists: (...a: unknown[]) => refreshLists(...a),
  subscribeListProblemsChanged: (cb: () => void) => {
    listener = cb
    return () => {
      listener = null
    }
  },
}))

const readListProblems = vi.fn<() => Promise<SavedListProblem[]>>()
vi.mock('./listsSync', () => ({
  readListProblems: () => readListProblems(),
}))

import { useListProblems } from './useListProblems'

function problem(id: string): SavedListProblem {
  return {
    id,
    listId: 'list-1',
    sourceCatalogId: `cat-${id}`,
    boardLayoutId: 7,
    addedBy: 'user-A',
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

function defer<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  listener = null
  refreshLists.mockResolvedValue({ synced: true })
})

describe('useListProblems out-of-order guard (#3)', () => {
  it('applies the latest issued read even if an earlier one resolves after it', async () => {
    // Initial load: fast-path + final read both settle to a stable set.
    readListProblems.mockResolvedValue([problem('a')])
    const { result } = renderHook(() => useListProblems('list-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems.map((p) => p.id)).toEqual(['a'])

    // Two rapid notifies (e.g. add then remove then add): read A is issued first but
    // resolves LAST with stale data; read B is issued second and resolves first.
    const first = defer<SavedListProblem[]>()
    const second = defer<SavedListProblem[]>()
    readListProblems.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    listener!() // issues read A (stale)
    listener!() // issues read B (fresh, latest)

    second.resolve([problem('b')])
    await waitFor(() => expect(result.current.problems.map((p) => p.id)).toEqual(['b']))

    // The stale earlier read arrives late and must be ignored.
    first.resolve([problem('stale')])
    await Promise.resolve()
    expect(result.current.problems.map((p) => p.id)).toEqual(['b'])
  })
})
