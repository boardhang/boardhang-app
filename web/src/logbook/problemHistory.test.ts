import { describe, expect, it } from 'vitest'
import type { Ascent } from './ascents'
import { ascentIdentity, priorHistoryIds, problemLogContext } from './problemHistory'

function ascent(overrides: Partial<Ascent>): Ascent {
  return {
    id: 'a1',
    date: '2026-07-24T10:00:00.000Z',
    sourceCatalogId: 'cat-1',
    userProblemId: null,
    problemName: 'Carafes',
    problemGrade: '6A+',
    votedGrade: '6A+',
    tries: 1,
    stars: 0,
    comment: '',
    sent: true,
    boardLayoutId: 7,
    ...overrides,
  }
}

describe('ascentIdentity', () => {
  it('prefers the catalog id, then the user-problem id, then the name', () => {
    expect(ascentIdentity(ascent({}))).toBe('cat-1')
    expect(ascentIdentity(ascent({ sourceCatalogId: null, userProblemId: 'up-1' }))).toBe('up-1')
    expect(ascentIdentity(ascent({ sourceCatalogId: null }))).toBe('name:Carafes')
  })
})

describe('problemLogContext', () => {
  const now = new Date('2026-07-24T18:00:00.000Z')

  it('is empty for a problem with no rows', () => {
    const other = ascent({ sourceCatalogId: 'cat-2' })
    expect(problemLogContext([other], 'cat-1', now)).toEqual({
      todayAttempt: null,
      todaySend: null,
      priorDays: 0,
      hasHistory: false,
    })
  })

  it('finds today’s most recent send by local day, ignoring attempts and other days', () => {
    const earlierSendToday = ascent({ id: 's1', sent: true, date: '2026-07-24T08:00:00.000Z' })
    const laterSendToday = ascent({ id: 's2', sent: true, date: '2026-07-24T12:00:00.000Z' })
    const attemptToday = ascent({ id: 'att', sent: false, date: '2026-07-24T09:00:00.000Z' })
    const sendYesterday = ascent({ id: 'old', sent: true, date: '2026-07-23T09:00:00.000Z' })
    const context = problemLogContext(
      [earlierSendToday, sendYesterday, laterSendToday, attemptToday],
      'cat-1',
      now,
    )
    expect(context.todaySend?.id).toBe('s2')
  })

  it('has no todaySend when the only send is from an earlier day', () => {
    const sendYesterday = ascent({ id: 'old', sent: true, date: '2026-07-23T09:00:00.000Z' })
    expect(problemLogContext([sendYesterday], 'cat-1', now).todaySend).toBeNull()
  })

  it('finds today’s unsent attempt row by local day, ignoring sends and other days', () => {
    // Zone-less timestamps parse as machine-local time, so the local-day assertions
    // hold in any test-runner timezone.
    const localNow = new Date('2026-07-24T18:00:00')
    const todayAttempt = ascent({ id: 'att', sent: false, tries: 3, date: '2026-07-24T09:00:00' })
    const todaySend = ascent({ id: 'send', sent: true, date: '2026-07-24T08:00:00' })
    const yesterdayAttempt = ascent({ id: 'old', sent: false, date: '2026-07-23T09:00:00' })
    const context = problemLogContext([todaySend, yesterdayAttempt, todayAttempt], 'cat-1', localNow)
    expect(context.todayAttempt?.id).toBe('att')
    expect(context.hasHistory).toBe(true)
  })

  it('does not absorb a cross-midnight attempt from the previous local day', () => {
    // 23:30 yesterday (local) vs a send today: local days differ, so the row is
    // yesterday's logbook entry and must NOT be offered for absorption — even when
    // the two timestamps share a UTC day bucket in some timezones.
    const lateYesterday = ascent({ id: 'late', sent: false, date: '2026-07-23T23:30:00' })
    const context = problemLogContext([lateYesterday], 'cat-1', new Date('2026-07-24T00:30:00'))
    expect(context.todayAttempt).toBeNull()
    expect(context.priorDays).toBe(1)
  })

  it('finds an attempt from earlier the same local day regardless of the UTC bucket', () => {
    // 00:30 local can fall in the previous UTC day (east-of-UTC zones); the absorb
    // must still find it for a send later the same local day.
    const earlyToday = ascent({ id: 'early', sent: false, tries: 2, date: '2026-07-24T00:30:00' })
    const context = problemLogContext([earlyToday], 'cat-1', new Date('2026-07-24T20:00:00'))
    expect(context.todayAttempt?.id).toBe('early')
  })

  it('counts distinct earlier local days, excluding today', () => {
    const rows = [
      ascent({ id: 'x1', date: '2026-07-20T10:00:00.000Z', sent: false }),
      ascent({ id: 'x2', date: '2026-07-20T15:00:00.000Z', sent: true }), // same day as x1
      ascent({ id: 'x3', date: '2026-07-22T10:00:00.000Z', sent: false }),
      ascent({ id: 'x4', date: '2026-07-24T10:00:00.000Z', sent: false }), // today
    ]
    expect(problemLogContext(rows, 'cat-1', now).priorDays).toBe(2)
  })
})

describe('priorHistoryIds', () => {
  it('flags every row dated after the problem’s earliest row', () => {
    const first = ascent({ id: 'first', date: '2026-07-20T10:00:00.000Z', sent: false })
    const later = ascent({ id: 'later', date: '2026-07-24T10:00:00.000Z' })
    const otherProblem = ascent({ id: 'other', sourceCatalogId: 'cat-2' })
    const ids = priorHistoryIds([later, first, otherProblem])
    expect(ids.has('later')).toBe(true)
    expect(ids.has('first')).toBe(false)
    expect(ids.has('other')).toBe(false)
  })

  it('never flags a problem with a single row', () => {
    expect(priorHistoryIds([ascent({})]).size).toBe(0)
  })
})
