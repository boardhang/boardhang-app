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
}))

vi.mock('../supabase/client', () => ({
  get supabase() {
    return {
      rpc: () => ({
        then: (res: (v: unknown) => void) => res({ data: h.rows, error: null }),
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
