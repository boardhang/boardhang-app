import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the change-listener so a test can fire live-update notifies.
let listener: (() => void) | null = null
vi.mock('./listsStore', () => ({
  subscribeListProblemsChanged: (cb: () => void) => {
    listener = cb
    return () => {
      listener = null
    }
  },
}))

const readListMemberIds = vi.fn<(ids: string[]) => Promise<Set<string>>>()
vi.mock('./listsSync', () => ({
  readListMemberIds: (ids: string[]) => readListMemberIds(ids),
}))

import { useListMemberIds } from './useListMemberIds'

beforeEach(() => {
  vi.clearAllMocks()
  listener = null
})

describe('useListMemberIds', () => {
  it('reads the union for a single list and flips ready', async () => {
    readListMemberIds.mockResolvedValue(new Set(['cat-a', 'cat-b']))
    const { result } = renderHook(() => useListMemberIds(['l1']))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect([...result.current.ids].sort()).toEqual(['cat-a', 'cat-b'])
  })

  it('unions across multiple lists (dedup via the returned set)', async () => {
    // The helper itself dedups; assert the hook surfaces the union it returns.
    readListMemberIds.mockResolvedValue(new Set(['cat-a', 'cat-b', 'cat-c']))
    const { result } = renderHook(() => useListMemberIds(['l1', 'l2']))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(readListMemberIds).toHaveBeenCalledWith(['l1', 'l2'])
    expect([...result.current.ids].sort()).toEqual(['cat-a', 'cat-b', 'cat-c'])
  })

  it('empty selection is ready immediately with an empty set and never reads', async () => {
    const { result } = renderHook(() => useListMemberIds([]))
    expect(result.current.ready).toBe(true)
    expect(result.current.ids.size).toBe(0)
    expect(readListMemberIds).not.toHaveBeenCalled()
  })

  it('is not ready during the first read (fail-open window), then ready after it resolves', async () => {
    let resolve!: (v: Set<string>) => void
    readListMemberIds.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useListMemberIds(['l1']))
    expect(result.current.ready).toBe(false)
    resolve(new Set(['cat-a']))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect([...result.current.ids]).toEqual(['cat-a'])
  })

  it('flips ready back to false while a changed selection re-reads, then true again', async () => {
    readListMemberIds.mockResolvedValue(new Set(['cat-a']))
    const { result, rerender } = renderHook(({ ids }) => useListMemberIds(ids), {
      initialProps: { ids: ['l1'] },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    // Change the selection: the new union is still loading, so ready must drop (fail-open)
    // rather than showing the stale l1 union as if it were the l2 result.
    let resolve!: (v: Set<string>) => void
    readListMemberIds.mockReturnValue(new Promise((r) => (resolve = r)))
    rerender({ ids: ['l2'] })
    expect(result.current.ready).toBe(false)
    resolve(new Set(['cat-b']))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect([...result.current.ids]).toEqual(['cat-b'])
  })

  it('re-reads on a subscribeListProblemsChanged notify (live)', async () => {
    readListMemberIds.mockResolvedValue(new Set(['cat-a']))
    const { result } = renderHook(() => useListMemberIds(['l1']))
    await waitFor(() => expect([...result.current.ids]).toEqual(['cat-a']))

    readListMemberIds.mockResolvedValue(new Set(['cat-a', 'cat-b']))
    listener!()
    await waitFor(() => expect([...result.current.ids].sort()).toEqual(['cat-a', 'cat-b']))
  })
})
