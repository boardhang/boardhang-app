// The live half of the catalog merge (R7): saving a problem repaints an already-mounted
// catalog list. Deliberately end-to-end over the REAL catalogSync, userProblemsStore and
// both IndexedDB databases — only Supabase is faked — because the value here is that the
// whole chain (mutation → change notification → merged re-read → hook state) is connected.
// useSlab.test.ts covers the hook's sync/degraded logic with catalogSync mocked out.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUserProblem, deleteUserProblem } from './userProblemsStore'
import { useSlab } from './useSlab'

const h = vi.hoisted(() => ({ tables: [] as string[] }))

// One builder for both shapes the code drives: the paged `.select().eq().range()` pulls and
// the `.insert().select().single()` write. Every pull returns an empty page (nothing to
// sync); the insert echoes its payload back the way PostgREST would, with the generated
// `source_catalog_id` and the trigger's `updated_at` filled in.
vi.mock('../supabase/client', () => {
  let inserted: Record<string, unknown> = {}
  const builder: Record<string, unknown> = {
    from: (table: string) => {
      h.tables.push(table)
      return builder
    },
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => builder,
    range: () => Promise.resolve({ data: [], error: null }),
    // `.update().eq()` is awaited directly by a delete but chained into `.select().single()`
    // by an edit, so the filter resolves as a promise that also carries the select chain.
    update: (patch: Record<string, unknown>) => ({
      eq: (_col: string, id: string) =>
        Object.assign(Promise.resolve({ data: null, error: null }), {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { ...patch, id, source_catalog_id: `user:${id}` }, error: null }),
          }),
        }),
    }),
    insert: (payload: Record<string, unknown>) => {
      inserted = payload
      return builder
    },
    single: () =>
      Promise.resolve({
        data: {
          ...inserted,
          source_catalog_id: `user:${inserted.id}`,
          updated_at: '2026-01-01T00:00:00+00:00',
          deleted: false,
        },
        error: null,
      }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'author-1' } } } }),
    },
  }
  return { supabase: builder, isConfigured: true }
})

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  h.tables = []
})

describe('useSlab and user problems', () => {
  it('shows a newly saved problem in the mounted list without a remount', async () => {
    const { result } = renderHook(() => useSlab(7, 40))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual([])

    await act(async () => {
      await createUserProblem({
        layoutId: 7,
        angle: 40,
        name: 'Crimpy',
        grade: '7A',
        holds: [{ c: 3, r: 4, t: 'start' }],
      })
    })

    await waitFor(() => expect(result.current.problems.map((p) => p.name)).toEqual(['Crimpy']))
    expect(result.current.problems[0]?.source_catalog_id).toMatch(/^user:/)
  })

  it('drops a deleted problem from the mounted list the same way', async () => {
    const { result } = renderHook(() => useSlab(7, 40))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let saved!: { sourceCatalogId: string }
    await act(async () => {
      saved = await createUserProblem({
        layoutId: 7,
        angle: 40,
        name: 'Crimpy',
        grade: '7A',
        holds: [],
      })
    })
    await waitFor(() => expect(result.current.problems).toHaveLength(1))

    await act(async () => {
      await deleteUserProblem(saved.sourceCatalogId)
    })
    await waitFor(() => expect(result.current.problems).toEqual([]))
  })

  it("pulls own problems on mount, so a failed post-sign-in pull isn't the only chance", async () => {
    renderHook(() => useSlab(7, 40))
    await waitFor(() => expect(h.tables).toContain('user_problems'))
  })
})
