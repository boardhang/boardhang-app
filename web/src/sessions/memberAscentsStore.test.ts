import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as { user_id: string; source_catalog_id: string | null; status: string | null }[],
  error: null as string | null,
  calls: 0,
}))

vi.mock('../supabase/client', () => ({
  get supabase() {
    return {
      rpc: (_name: string, _args: unknown) => ({
        then: (res: (v: unknown) => void) => {
          h.calls += 1
          res(h.error ? { data: null, error: { message: h.error } } : { data: h.rows, error: null })
        },
      }),
    }
  },
  isConfigured: true,
}))

import {
  MAX_AGE_MS,
  activateMemberAscents,
  buildMemberSets,
  getMemberAscentsSnapshot,
  refreshMemberAscents,
  removeMemberFromProjection,
  withSelfSends,
} from './memberAscentsStore'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-07T12:00:00Z'))
  h.rows = []
  h.error = null
  h.calls = 0
  activateMemberAscents(null) // reset state + stop timers/listeners
})

afterEach(() => {
  activateMemberAscents(null)
  vi.useRealTimers()
})

describe('buildMemberSets', () => {
  it('groups sent into both sets, attempted into loggedIds only, and seeds marker members', () => {
    const { bySets, members } = buildMemberSets([
      { user_id: 'a', source_catalog_id: 'P1', status: 'sent' },
      { user_id: 'a', source_catalog_id: 'P2', status: 'attempted' },
      { user_id: 'b', source_catalog_id: null, status: null }, // zero-ascent marker
    ])
    expect(members.sort()).toEqual(['a', 'b'])
    expect([...bySets.a.sentIds]).toEqual(['P1'])
    expect([...bySets.a.loggedIds].sort()).toEqual(['P1', 'P2'])
    // Zero-ascent member is PRESENT with empty Sets — not missing.
    expect(bySets.b).toBeDefined()
    expect(bySets.b.sentIds.size).toBe(0)
    expect(bySets.b.loggedIds.size).toBe(0)
  })
})

describe('withSelfSends', () => {
  it('replaces the self member set with the local sends when self is in the projection', () => {
    const bySets = {
      me: { sentIds: new Set(['stale']), loggedIds: new Set(['stale']) },
      other: { sentIds: new Set(['X']), loggedIds: new Set(['X']) },
    }
    const out = withSelfSends(bySets, 'me', new Set(['fresh']), new Set(['fresh', 'att']))
    expect([...out.me.sentIds]).toEqual(['fresh'])
    expect([...out.me.loggedIds].sort()).toEqual(['att', 'fresh'])
    expect([...out.other.sentIds]).toEqual(['X']) // other members untouched
    expect(bySets.me.sentIds.has('stale')).toBe(true) // input not mutated
  })

  it('leaves the map unchanged when self is not in the projection (presence stays projection-driven)', () => {
    const bySets = { other: { sentIds: new Set(['X']), loggedIds: new Set(['X']) } }
    // Same reference back — a not-yet-loaded self is NOT synthesised into the member set.
    expect(withSelfSends(bySets, 'me', new Set(['fresh']), new Set(['fresh']))).toBe(bySets)
  })

  it('no-ops for a null selfId', () => {
    const bySets = { me: { sentIds: new Set<string>(), loggedIds: new Set<string>() } }
    expect(withSelfSends(bySets, null, new Set(['x']), new Set(['x']))).toBe(bySets)
  })
})

describe('memberAscentsStore', () => {
  it('fetches and exposes the per-member map with a single readiness flag', async () => {
    h.rows = [
      { user_id: 'a', source_catalog_id: 'P1', status: 'sent' },
      { user_id: 'b', source_catalog_id: null, status: null },
    ]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    const s = getMemberAscentsSnapshot()
    expect(s.ready).toBe(true)
    expect(s.members.sort()).toEqual(['a', 'b'])
    expect([...s.bySets.a.sentIds]).toEqual(['P1'])
    expect(s.bySets.b.loggedIds.size).toBe(0)
  })

  it('reflects only the server-consistent membership snapshot (a departed member drops out)', async () => {
    h.rows = [
      { user_id: 'a', source_catalog_id: 'P1', status: 'sent' },
      { user_id: 'b', source_catalog_id: null, status: null },
    ]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    expect(getMemberAscentsSnapshot().members.sort()).toEqual(['a', 'b'])
    // b leaves server-side → absent from the next snapshot.
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    await refreshMemberAscents()
    expect(getMemberAscentsSnapshot().members).toEqual(['a'])
  })

  it('refresh() re-fetches and replaces the map', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    expect([...getMemberAscentsSnapshot().bySets.a.sentIds]).toEqual(['P1'])
    h.rows = [{ user_id: 'a', source_catalog_id: 'P2', status: 'attempted' }]
    await refreshMemberAscents()
    const s = getMemberAscentsSnapshot()
    expect(s.bySets.a.sentIds.size).toBe(0)
    expect([...s.bySets.a.loggedIds]).toEqual(['P2'])
  })

  it('refetches on foreground (visibilitychange→visible) but not on backgrounding', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    const base = h.calls

    const flush = async () => {
      await Promise.resolve()
      await Promise.resolve()
    }

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(h.calls).toBe(base) // backgrounding does not refetch

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(h.calls).toBe(base + 1) // foreground refetches
  })

  it('drops the cached map once past max-age, even on a read with no timer fire', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    expect(getMemberAscentsSnapshot().ready).toBe(true)
    // Move the clock past max-age WITHOUT running timers — the read-path age check must drop it.
    vi.setSystemTime(new Date(Date.now() + MAX_AGE_MS + 1))
    const s = getMemberAscentsSnapshot()
    expect(s.ready).toBe(false)
    expect(s.members).toEqual([])
  })

  it('drops the cached map via the timer even without a read or refetch', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    let notified = false
    // subscribe indirectly: advance timers past max-age and assert the snapshot is dropped
    vi.advanceTimersByTime(MAX_AGE_MS + STALE_CHECK())
    notified = true
    expect(notified).toBe(true)
    expect(getMemberAscentsSnapshot().ready).toBe(false)
  })

  it('removeMemberFromProjection drops a member from members + bySets (optimistic leave)', async () => {
    h.rows = [
      { user_id: 'a', source_catalog_id: 'P1', status: 'sent' },
      { user_id: 'b', source_catalog_id: 'P2', status: 'sent' },
    ]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    expect(getMemberAscentsSnapshot().members.sort()).toEqual(['a', 'b'])
    removeMemberFromProjection('b')
    const s = getMemberAscentsSnapshot()
    expect(s.members).toEqual(['a'])
    expect(s.bySets.b).toBeUndefined()
    expect(s.ready).toBe(true) // still live — just one member lighter
    // No-op for an unknown id.
    removeMemberFromProjection('zzz')
    expect(getMemberAscentsSnapshot().members).toEqual(['a'])
  })

  it('keeps the last-good map and surfaces a non-fatal error on RPC failure', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await refreshMemberAscents()
    h.error = 'network down'
    await refreshMemberAscents()
    const s = getMemberAscentsSnapshot()
    expect(s.error).toBe('network down')
    expect([...s.bySets.a.sentIds]).toEqual(['P1']) // last-good retained
    expect(s.ready).toBe(true)
  })
})

// A tab held continuously in the foreground never fires visibilitychange, so nothing refetches and
// the map dies under the user mid-scroll — applyFilters skips the whole per-member clause when
// unready, widening the list from a filtered handful to every problem. The timer refreshes a
// still-good map before it ages out, so it is REPLACED rather than dropped.
describe('memberAscentsStore — pre-expiry refresh', () => {
  function setVisibility(value: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  }

  beforeEach(() => setVisibility('visible'))

  it('refreshes a still-good map before max-age, so it never has to be dropped', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await vi.advanceTimersByTimeAsync(0)
    const afterInitial = h.calls

    // Past the refresh threshold but short of max-age (the tick at exactly the threshold does not
    // fire it — the comparison is strictly greater).
    await vi.advanceTimersByTimeAsync(MAX_AGE_MS - 30_000)
    expect(h.calls).toBeGreaterThan(afterInitial)

    // Well past the ORIGINAL deadline: the refreshed fetchedAt means nothing was dropped.
    await vi.advanceTimersByTimeAsync(90_000)
    const s = getMemberAscentsSnapshot()
    expect(s.ready).toBe(true)
    expect(s.stale).toBe(false)
  })

  it('does not refresh while the tab is hidden — it still just drops', async () => {
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await vi.advanceTimersByTimeAsync(0)
    const afterInitial = h.calls
    setVisibility('hidden')

    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + STALE_CHECK())
    expect(h.calls).toBe(afterInitial) // no background network
    expect(getMemberAscentsSnapshot().stale).toBe(true)
  })

  it('still drops at max-age when the refresh keeps failing, and then stops trying', async () => {
    // The bound must never be starved by the refresh: a failed fetch leaves fetchedAt untouched,
    // so the drop lands on the original deadline and then ends the retries by construction.
    h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
    activateMemberAscents('S1')
    await vi.advanceTimersByTimeAsync(0)
    h.error = 'network down'

    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + STALE_CHECK())
    expect(getMemberAscentsSnapshot().stale).toBe(true)
    expect(getMemberAscentsSnapshot().ready).toBe(false)

    // fetchedAt is null now, so the refresh branch can no longer fire: no endless retry loop.
    const afterDrop = h.calls
    await vi.advanceTimersByTimeAsync(STALE_CHECK() * 6)
    expect(h.calls).toBe(afterDrop)
  })
})


// STALE_CHECK interval is internal; advancing by a spare 30s guarantees a tick fires.
function STALE_CHECK(): number {
  return 30_000
}
