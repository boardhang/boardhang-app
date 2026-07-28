// A max-age drop performed on the READ path must reach every subscriber, not just whichever one
// happened to trigger it. This needs React to observe: useSyncExternalStore caches its snapshot
// and only re-reads when notified, so a store that mutates without notifying leaves a component
// rendering data the store no longer holds. That is invisible to an imperative snapshot assertion
// (getMemberAscentsSnapshot runs the age check itself), which is why this lives apart from
// memberAscentsStore.test.ts.

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as { user_id: string; source_catalog_id: string | null; status: string | null }[],
  error: null as string | null,
  calls: 0,
}))

vi.mock('../supabase/client', () => ({
  get supabase() {
    return {
      rpc: () => ({
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
  getMemberAscentsSnapshot,
  useMemberAscents,
} from './memberAscentsStore'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-07T12:00:00Z'))
  h.rows = [{ user_id: 'a', source_catalog_id: 'P1', status: 'sent' }]
  h.error = null
  h.calls = 0
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  activateMemberAscents(null)
})

afterEach(() => {
  activateMemberAscents(null)
  vi.useRealTimers()
})

describe('memberAscents — a read-path drop reaches every subscriber', () => {
  it('re-renders a subscriber that was not the one to age the map out', async () => {
    const { result } = renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.ready).toBe(true)

    // Age it out without letting the 30s timer fire, then have a DIFFERENT reader perform the
    // drop — the imperative snapshot stands in for another component rendering first.
    vi.setSystemTime(new Date(Date.now() + MAX_AGE_MS + 1_000))
    expect(getMemberAscentsSnapshot().stale).toBe(true)

    // The hook must learn about it. Before the scheduled notify, it kept ready:true and the old
    // map forever: the timer's own applyStaleness now returns false, so its notify never fires.
    await vi.advanceTimersByTimeAsync(0)
    expect(result.current.ready).toBe(false)
    expect(result.current.stale).toBe(true)
    expect(result.current.bySets).toEqual({})
  })
})

// A tab held continuously in the foreground never fires visibilitychange, so nothing refetched and
// the map died under the user mid-scroll — applyFilters skips the whole per-member clause when
// unready, widening the list from a filtered handful to every problem. The timer refreshes a
// still-good map before it ages out, so it is REPLACED rather than dropped. These live here rather
// than in memberAscentsStore.test.ts because the refresh requires a real SUBSCRIBER, and mounting
// the hook is what supplies one.
describe('memberAscents — pre-expiry refresh', () => {
  it('refreshes a still-good map before max-age, so it never has to be dropped', async () => {
    renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    const afterInitial = h.calls

    // Past the refresh threshold but short of max-age (the tick landing exactly on the threshold
    // does not fire it — the comparison is strictly greater).
    await vi.advanceTimersByTimeAsync(MAX_AGE_MS - 30_000)
    expect(h.calls).toBeGreaterThan(afterInitial)

    // Well past the ORIGINAL deadline: the refreshed fetchedAt means nothing was dropped.
    await vi.advanceTimersByTimeAsync(90_000)
    expect(getMemberAscentsSnapshot().ready).toBe(true)
    expect(getMemberAscentsSnapshot().stale).toBe(false)
  })

  it('does not refresh with no subscriber, even on a visible tab', async () => {
    // The store stays activated for the whole session, so without this guard a user sitting on
    // Settings would keep pulling the crew's ascent data every few minutes for no reader.
    activateMemberAscents('S1')
    await vi.advanceTimersByTimeAsync(0)
    const afterInitial = h.calls

    await vi.advanceTimersByTimeAsync(MAX_AGE_MS - 30_000)
    expect(h.calls).toBe(afterInitial)
  })

  it('does not refresh while the tab is hidden — it still just drops', async () => {
    renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    const afterInitial = h.calls
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + 30_000)
    expect(h.calls).toBe(afterInitial) // no background network
    expect(getMemberAscentsSnapshot().stale).toBe(true)
  })

  it('still drops at max-age when the refresh keeps failing', async () => {
    // The bound must never be starved by the refresh: a failed fetch leaves fetchedAt untouched,
    // so the drop lands on the original deadline regardless of how the refresh is going.
    renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    h.error = 'network down'

    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + 30_000)
    expect(getMemberAscentsSnapshot().stale).toBe(true)
    expect(getMemberAscentsSnapshot().ready).toBe(false)
  })

  it('keeps retrying after the drop, rate-limited, and recovers when the network returns', async () => {
    // One bad minute must not be permanent: the drop nulls fetchedAt, so the pre-expiry branch
    // can never fire again, and a foregrounded tab produces no visibilitychange to fall back on.
    renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    h.error = 'network down'
    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + 30_000)
    expect(getMemberAscentsSnapshot().stale).toBe(true)

    // Retries continue, but at RETRY_AFTER_MS (2 ticks), not on every tick.
    const afterDrop = h.calls
    await vi.advanceTimersByTimeAsync(30_000 * 6) // 6 ticks -> ~3 attempts, not 6
    const retries = h.calls - afterDrop
    expect(retries).toBeGreaterThan(0)
    expect(retries).toBeLessThanOrEqual(3)

    // Network comes back: the filter re-arms itself with no user action.
    h.error = null
    await vi.advanceTimersByTimeAsync(30_000 * 3)
    expect(getMemberAscentsSnapshot().ready).toBe(true)
    expect(getMemberAscentsSnapshot().stale).toBe(false)
  })

  it('stops retrying once nothing is subscribed', async () => {
    const { unmount } = renderHook(() => useMemberAscents('S1'))
    await vi.advanceTimersByTimeAsync(0)
    h.error = 'network down'
    await vi.advanceTimersByTimeAsync(MAX_AGE_MS + 30_000)
    unmount()

    const afterUnmount = h.calls
    await vi.advanceTimersByTimeAsync(30_000 * 6)
    expect(h.calls).toBe(afterUnmount)
  })
})
