import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { cacheUserProblems, setCachedUserId } from './userProblemsSync'
import { userProblemCatalogId, type UserProblemRow } from './userProblemsTypes'
import { useUserProblemFacets } from './useUserProblemFacets'

function row(over: Partial<UserProblemRow> & { id: string; user_id: string }): UserProblemRow {
  return {
    name: 'Problem',
    grade: '6B',
    holds: [],
    layout_id: 7,
    angle: 40,
    visibility: 'private',
    source_catalog_id: userProblemCatalogId(over.id),
    updated_at: '2026-07-01T00:00:00Z',
    deleted: false,
    setter_user_id: null,
    setter_handle: null,
    ...over,
  }
}

beforeEach(() => {
  indexedDB = new IDBFactory()
})

describe('useUserProblemFacets', () => {
  it('reports own ids and this slab’s recency once the cache read resolves', async () => {
    await setCachedUserId('me')
    await cacheUserProblems([
      row({ id: 'a', user_id: 'me', updated_at: '2026-07-01T00:00:00Z' }),
      row({ id: 'b', user_id: 'other', updated_at: '2026-07-09T00:00:00Z' }),
      // A different slab — present in the cache, absent from this board+angle's recency map.
      row({ id: 'c', user_id: 'other', angle: 25, updated_at: '2026-07-20T00:00:00Z' }),
    ])

    const { result } = renderHook(() => useUserProblemFacets(7, 40))
    // Fails open until the read lands — the facet must not filter against an empty set.
    expect(result.current.ready).toBe(false)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect([...result.current.ownProblemIds]).toEqual(['user:a'])
    expect([...result.current.recencyById.entries()]).toEqual([
      ['user:a', '2026-07-01T00:00:00Z'],
      ['user:b', '2026-07-09T00:00:00Z'],
    ])
  })

  it('has no own ids when the cache belongs to nobody (signed out)', async () => {
    await cacheUserProblems([row({ id: 'b', user_id: 'other' })])
    const { result } = renderHook(() => useUserProblemFacets(7, 40))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.ownProblemIds.size).toBe(0)
    expect(result.current.recencyById.has('user:b')).toBe(true)
  })
})
