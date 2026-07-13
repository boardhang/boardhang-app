import { describe, expect, it } from 'vitest'
import { buildSenders } from './useMemberSenders'
import type { MemberAscentsMap } from '../sessions/memberAscentsStore'
import type { SessionMember } from '../sessions/sessionsTypes'

function member(userId: string, displayName: string | null): SessionMember {
  return { userId, joinedAt: '2026-07-13T00:00:00Z', handle: null, displayName, avatarUrl: null }
}

const roster: SessionMember[] = [
  member('self', 'Me'),
  member('alice', 'Alice'),
  member('bob', 'Bob'),
]

function sets(map: Record<string, string[]>): MemberAscentsMap {
  return Object.fromEntries(
    Object.entries(map).map(([uid, ids]) => [uid, { sentIds: new Set(ids), loggedIds: new Set(ids) }]),
  )
}

describe('buildSenders', () => {
  it('includes every crew member who sent a problem, self first and flagged', () => {
    const senders = buildSenders(
      ['alice', 'self', 'bob'],
      'self',
      sets({ self: ['X'], alice: ['X'], bob: ['X'] }),
      roster,
    )
    const chips = senders.get('X')!
    expect(chips.map((c) => c.userId)).toEqual(['self', 'alice', 'bob']) // self sorts first
    expect(chips[0].isSelf).toBe(true)
    expect(chips[0].label).toBe('You')
    expect(chips.slice(1).every((c) => !c.isSelf)).toBe(true)
  })

  it('shows self alone when only you have sent it', () => {
    const senders = buildSenders(['self', 'alice'], 'self', sets({ self: ['X'] }), roster)
    expect(senders.get('X')!.map((c) => c.userId)).toEqual(['self'])
    expect(senders.get('X')![0].isSelf).toBe(true)
  })

  it('orders other senders in the members-snapshot order after self', () => {
    const senders = buildSenders(
      ['bob', 'alice', 'self'],
      'self',
      sets({ bob: ['X'], alice: ['X'] }),
      roster,
    )
    expect(senders.get('X')!.map((c) => c.userId)).toEqual(['bob', 'alice'])
  })

  it('skips zero-ascent members without crashing', () => {
    const senders = buildSenders(
      ['self', 'alice', 'bob'],
      'self',
      sets({ alice: [], bob: ['X'] }),
      roster,
    )
    expect(senders.get('X')!.map((c) => c.userId)).toEqual(['bob'])
  })

  it('yields deterministic non-blank initials for a member missing from the roster', () => {
    const senders = buildSenders(['self', 'ghost'], 'self', sets({ ghost: ['X'] }), roster)
    const chip = senders.get('X')![0]
    expect(chip.userId).toBe('ghost')
    expect(chip.isSelf).toBe(false)
    expect(chip.initials).toMatch(/^[A-Z]$/)
    expect(chip.label.length).toBeGreaterThan(0)
  })

  it('maps a member with several sends onto each problem', () => {
    const senders = buildSenders(['self', 'alice'], 'self', sets({ alice: ['X', 'Y'] }), roster)
    expect(senders.get('X')![0].userId).toBe('alice')
    expect(senders.get('Y')![0].userId).toBe('alice')
  })

  it('returns an empty map when nobody in the crew has sent anything', () => {
    const senders = buildSenders(['self', 'alice'], 'self', sets({ alice: [] }), roster)
    expect(senders.size).toBe(0)
  })

  it('uses the roster display label and avatar url for other members', () => {
    const withAvatar: SessionMember[] = [{ ...member('alice', 'Alice'), avatarUrl: 'https://cdn/a.png' }]
    const senders = buildSenders(['alice'], 'self', sets({ alice: ['X'] }), withAvatar)
    const chip = senders.get('X')![0]
    expect(chip.label).toBe('Alice')
    expect(chip.avatarUrl).toBe('https://cdn/a.png')
    expect(chip.initials).toBe('AL')
  })
})
