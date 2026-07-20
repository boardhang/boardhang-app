import { describe, expect, it } from 'vitest'
import { latestSession } from './profileStats'
import type { SendItem } from './socialTypes'

function send(over: Partial<SendItem>): SendItem {
  return {
    ascentId: 'a',
    actorId: 'u',
    handle: 'h',
    displayName: 'H',
    avatarUrl: null,
    sourceCatalogId: null,
    userProblemId: null,
    problemName: 'P',
    problemGrade: '6A',
    boardLayoutId: 1,
    climbedAt: '2026-07-10T12:00:00.000Z',
    firstSentAt: '2026-07-10T12:00:00.000Z',
    tries: 1,
    ...over,
  }
}

describe('latestSession', () => {
  it('returns null for no sends', () => {
    expect(latestSession([])).toBeNull()
  })

  it('groups the sends from the most recent local day', () => {
    const s = latestSession([
      send({ ascentId: 'old', climbedAt: '2026-07-01T10:00:00.000Z' }),
      send({ ascentId: 'new1', climbedAt: '2026-07-10T09:00:00.000Z' }),
      send({ ascentId: 'new2', climbedAt: '2026-07-10T18:00:00.000Z' }),
    ])
    expect(s?.sends.map((x) => x.ascentId)).toEqual(['new2', 'new1'])
  })

  it('ignores input order — the latest climbed day wins', () => {
    const s = latestSession([
      send({ ascentId: 'new', climbedAt: '2026-07-10T09:00:00.000Z' }),
      send({ ascentId: 'newer', climbedAt: '2026-07-12T09:00:00.000Z' }),
    ])
    expect(s?.sends.map((x) => x.ascentId)).toEqual(['newer'])
  })
})
