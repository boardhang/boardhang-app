import { describe, expect, it } from 'vitest'
import type { Ascent } from './ascents'
import { pyramid, sessions } from './sessions'

function ascent(partial: Partial<Ascent>): Ascent {
  return {
    id: partial.id ?? crypto.randomUUID(),
    date: partial.date ?? '2026-07-04T12:00:00Z',
    sourceCatalogId: partial.sourceCatalogId ?? null,
    userProblemId: partial.userProblemId ?? null,
    problemName: partial.problemName ?? 'Test',
    problemGrade: partial.problemGrade ?? '6B',
    votedGrade: partial.votedGrade ?? '6B',
    tries: partial.tries ?? 1,
    stars: partial.stars ?? 0,
    comment: partial.comment ?? '',
    sent: partial.sent ?? true,
    boardLayoutId: partial.boardLayoutId ?? 7,
  }
}

describe('sessions', () => {
  it('groups ascents by local calendar day, newest first', () => {
    const list = [
      ascent({ id: 'a', date: '2026-07-04T09:00:00' }),
      ascent({ id: 'b', date: '2026-07-04T18:00:00' }),
      ascent({ id: 'c', date: '2026-07-02T10:00:00' }),
    ]
    const result = sessions(list)
    expect(result.map((s) => s.dayKey)).toEqual(['2026-07-04', '2026-07-02'])
    // Newest ascent first within a day.
    expect(result[0].ascents.map((a) => a.id)).toEqual(['b', 'a'])
  })

  it('titles a session with weekday, date and pluralized count', () => {
    const single = sessions([ascent({ date: '2026-07-04T09:00:00' })])
    expect(single[0].title).toMatch(/— 1 problem$/)
    const multi = sessions([
      ascent({ date: '2026-07-04T09:00:00' }),
      ascent({ date: '2026-07-04T10:00:00' }),
    ])
    expect(multi[0].title).toMatch(/— 2 problems$/)
  })
})

describe('pyramid', () => {
  it('counts unique sends per grade, split by try-bucket', () => {
    const { rows, domain, maxTotal } = pyramid([
      ascent({ sourceCatalogId: 'p1', problemGrade: '6B', tries: 1 }), // flash
      ascent({ sourceCatalogId: 'p2', problemGrade: '6B', tries: 3 }), // 3rd
      ascent({ sourceCatalogId: 'p3', problemGrade: '7A', tries: 5 }), // 4+
    ])
    expect(domain).toEqual(['6B', '7A'])
    expect(maxTotal).toBe(2)
    const sixB = rows.find((r) => r.grade === '6B')!
    expect(sixB.Flash).toBe(1)
    expect(sixB['3rd']).toBe(1)
    expect(sixB.total).toBe(2)
  })

  it('keeps only the earliest send of a repeated problem', () => {
    const { rows } = pyramid([
      ascent({ sourceCatalogId: 'p1', problemGrade: '6B', date: '2026-07-04T00:00:00Z', tries: 4 }),
      ascent({ sourceCatalogId: 'p1', problemGrade: '6B', date: '2026-07-01T00:00:00Z', tries: 1 }),
    ])
    const sixB = rows.find((r) => r.grade === '6B')!
    expect(sixB.total).toBe(1)
    // The earliest send (a flash) is the one kept.
    expect(sixB.Flash).toBe(1)
    expect(sixB['4+ tries']).toBe(0)
  })

  it('excludes attempts-only logs', () => {
    const { rows, domain } = pyramid([
      ascent({ sourceCatalogId: 'p1', problemGrade: '6B', sent: false }),
    ])
    expect(domain).toEqual([])
    expect(rows).toEqual([])
  })

  it('orders the domain by the canonical grade scale, not lexically', () => {
    const { domain } = pyramid([
      ascent({ sourceCatalogId: 'a', problemGrade: '7A' }),
      ascent({ sourceCatalogId: 'b', problemGrade: '6C+' }),
      ascent({ sourceCatalogId: 'c', problemGrade: '6A' }),
    ])
    expect(domain).toEqual(['6A', '6C+', '7A'])
  })
})
