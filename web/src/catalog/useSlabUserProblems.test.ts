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
import { cacheUserProblems, readUserProblemsForSlab } from './userProblemsSync'
import type { UserProblemRow } from './userProblemsTypes'
import { useSlab } from './useSlab'

const h = vi.hoisted(() => ({ tables: [] as string[], eqArgs: [] as Array<[string, unknown]> }))

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
    eq: (col: string, val: unknown) => {
      h.eqArgs.push([col, val])
      return builder
    },
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
  h.eqArgs = []
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

  // AE2, this device's half: user A retracted a problem user B had synced, so it is simply
  // absent from B's next per-slab snapshot (the fake serves an empty one) and has to leave
  // both the cache and the open list. B's logbook is untouched — an ascent row renders from
  // its own denormalized name/grade (AscentRow reads `ascent.problemName`), which
  // ProblemDetailOwnerMenu.test.tsx already asserts for the stronger case of a deletion.
  it('drops another setter’s retracted problem from the mounted list on the next sync (AE2)', async () => {
    const retracted: UserProblemRow = {
      id: 'a-1',
      user_id: 'author-A',
      name: 'Was public',
      grade: '7B',
      holds: [],
      layout_id: 7,
      angle: 40,
      visibility: 'public',
      source_catalog_id: 'user:a-1',
      updated_at: '2026-07-01T00:00:00+00:00',
      deleted: false,
      setter_user_id: 'author-A',
      setter_handle: 'lorna',
    }
    await cacheUserProblems([retracted])
    expect(await readUserProblemsForSlab(7, 40)).toHaveLength(1)

    const { result } = renderHook(() => useSlab(7, 40))

    // The cache first, because `problems` starts empty and would pass vacuously.
    await waitFor(async () => expect(await readUserProblemsForSlab(7, 40)).toEqual([]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.problems).toEqual([])
  })

  it('re-pulls the author’s own rows on pull-to-refresh, not only the public snapshot', async () => {
    const { result } = renderHook(() => useSlab(7, 40))
    await waitFor(() => expect(result.current.loading).toBe(false))
    h.eqArgs = []

    await act(async () => {
      await result.current.resync()
    })

    // Two different queries: the own-rows delta is scoped by `user_id`, the per-slab snapshot
    // by `visibility`. A refresh that fired only the second one would leave a problem edited
    // on another device — or any private one — permanently stale on this device.
    expect(h.eqArgs).toContainEqual(['user_id', 'author-1'])
    expect(h.eqArgs).toContainEqual(['visibility', 'public'])
  })

  it('keeps this user’s own problem, which no public snapshot can list', async () => {
    let saved!: { sourceCatalogId: string }
    await act(async () => {
      saved = await createUserProblem({ layoutId: 7, angle: 40, name: 'Mine', grade: '6C', holds: [] })
    })

    const { result } = renderHook(() => useSlab(7, 40))

    await waitFor(() => expect(result.current.loading).toBe(false))
    // The snapshot is empty, and evicting by absence would delete the author's own work.
    expect(result.current.problems.map((p) => p.source_catalog_id)).toEqual([saved.sourceCatalogId])
  })
})
