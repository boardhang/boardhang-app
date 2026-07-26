// Store-level guards around the absorb flow: the flush must trust the SERVER copy of
// the attempt row (a stale local copy from another tab/device would resurrect tries a
// send already folded in), and the absorb delete must keep the row when a peer added
// tries after the sheet's snapshot.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const supa = vi.hoisted(() => ({
  maybeSingle: { data: null as unknown, error: null as unknown },
  upserts: [] as Record<string, unknown>[],
  updates: [] as { patch: Record<string, unknown>; id: unknown }[],
}))

vi.mock('../supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => supa.maybeSingle }),
      }),
      upsert: (row: Record<string, unknown>) => {
        supa.upserts.push(row)
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          supa.updates.push({ patch, id })
          return { error: null }
        },
      }),
    }),
  },
}))

import { absorbAttemptRow, addAttemptTries, createAscent, resetAscents } from './ascents'
import { attemptId } from './attemptId'

const DATE = '2026-07-24T10:00:00'

async function seedLocalAttempt(tries: number): Promise<string> {
  const id = await attemptId('cat-1', new Date(DATE))
  await createAscent({
    id,
    date: DATE,
    sourceCatalogId: 'cat-1',
    userProblemId: null,
    problemName: 'P',
    problemGrade: '6A',
    votedGrade: '6A',
    tries,
    stars: 0,
    comment: '',
    sent: false,
    boardLayoutId: 7,
  })
  supa.upserts.length = 0
  return id
}

beforeEach(() => {
  resetAscents()
  supa.maybeSingle = { data: null, error: null }
  supa.upserts.length = 0
  supa.updates.length = 0
})

describe('addAttemptTries — server-authoritative accumulate', () => {
  const input = {
    sourceCatalogId: 'cat-1',
    problemName: 'P',
    problemGrade: '6A',
    boardLayoutId: 7,
    date: DATE,
    addTries: 2,
  }

  it('trusts the server row over a stale local copy', async () => {
    await seedLocalAttempt(5) // stale local: another tab may have absorbed since
    supa.maybeSingle = { data: { tries: 1, deleted: false }, error: null }
    await addAttemptTries(input)
    expect(supa.upserts[0].tries).toBe(3) // 1 (server) + 2, not 5 (local) + 2
  })

  it('revives a soft-deleted row from zero instead of resurrecting absorbed tries', async () => {
    await seedLocalAttempt(5)
    supa.maybeSingle = { data: { tries: 5, deleted: true }, error: null }
    await addAttemptTries(input)
    expect(supa.upserts[0].tries).toBe(2)
  })

  it('falls back to the local copy when the server read fails', async () => {
    await seedLocalAttempt(5)
    supa.maybeSingle = { data: null, error: { message: 'network' } }
    await addAttemptTries(input)
    expect(supa.upserts[0].tries).toBe(7)
  })
})

describe('absorbAttemptRow — guarded soft delete', () => {
  it('deletes when the row still holds exactly the folded tries', async () => {
    supa.maybeSingle = { data: { tries: 3, deleted: false }, error: null }
    await absorbAttemptRow('att-1', 3)
    expect(supa.updates).toHaveLength(1)
    expect(supa.updates[0].patch).toEqual({ deleted: true })
    expect(supa.updates[0].id).toBe('att-1')
  })

  it('keeps the row when a peer added tries after the snapshot', async () => {
    supa.maybeSingle = { data: { tries: 5, deleted: false }, error: null }
    await absorbAttemptRow('att-1', 3)
    expect(supa.updates).toHaveLength(0)
  })

  it('keeps the row when the verification read fails or finds nothing', async () => {
    supa.maybeSingle = { data: null, error: { message: 'network' } }
    await absorbAttemptRow('att-1', 3)
    supa.maybeSingle = { data: null, error: null }
    await absorbAttemptRow('att-1', 3)
    expect(supa.updates).toHaveLength(0)
  })
})
