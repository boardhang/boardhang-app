import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FollowRequestRow, NotificationRow } from './socialTypes'

const h = vi.hoisted(() => ({
  requests: [] as FollowRequestRow[],
  activity: [] as NotificationRow[],
  failRespond: false,
  respondCalls: [] as { follower: string; accept: boolean }[],
  markCalls: [] as string[][],
}))

vi.mock('../supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_follow_requests') return { data: h.requests, error: null }
      if (name === 'get_notifications') return { data: h.activity, error: null }
      if (name === 'respond_to_follow') {
        if (h.failRespond) return { data: null, error: { message: 'net' } }
        h.respondCalls.push({ follower: args.p_follower as string, accept: args.p_accept as boolean })
        return { data: null, error: null }
      }
      if (name === 'mark_notifications_read') {
        h.markCalls.push(args.p_ids as string[])
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
  },
}))

const store = await import('./notificationsStore')

function req(id: string): FollowRequestRow {
  return { id, handle: id, display_name: id, avatar_url: null, is_private: false, requested_at: '2026-07-20T00:00:00Z' }
}
function act(id: string, read: boolean): NotificationRow {
  return {
    id,
    type: 'follow',
    actor_id: `a-${id}`,
    handle: `a-${id}`,
    display_name: id,
    avatar_url: null,
    created_at: '2026-07-20T00:00:00Z',
    read_at: read ? '2026-07-20T01:00:00Z' : null,
  }
}

beforeEach(() => {
  h.requests = []
  h.activity = []
  h.failRespond = false
  h.respondCalls = []
  h.markCalls = []
  store.resetNotifications()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('notificationsStore', () => {
  it('loads requests and activity', async () => {
    h.requests = [req('r1')]
    h.activity = [act('n1', false)]
    await store.loadNotifications()
    const s = store.getNotificationsSnapshot()
    expect(s.status).toBe('loaded')
    expect(s.requests).toHaveLength(1)
    expect(s.activity).toHaveLength(1)
  })

  it('badge counts pending requests plus unread activity', async () => {
    h.requests = [req('r1'), req('r2')]
    h.activity = [act('n1', false), act('n2', true)] // 1 unread
    await store.loadNotifications()
    expect(store.badgeCount()).toBe(3) // 2 requests + 1 unread
  })

  it('badge is nonzero for a pending request with zero unread activity', async () => {
    h.requests = [req('r1')]
    h.activity = [act('n1', true)] // all read
    await store.loadNotifications()
    expect(store.badgeCount()).toBe(1)
  })

  it('approving a request removes it and calls respond_to_follow', async () => {
    h.requests = [req('r1')]
    await store.loadNotifications()
    await store.resolveRequest('r1', true)
    expect(store.getNotificationsSnapshot().requests).toHaveLength(0)
    expect(h.respondCalls).toEqual([{ follower: 'r1', accept: true }])
  })

  it('a failed resolve rolls the request back into the list', async () => {
    h.requests = [req('r1')]
    await store.loadNotifications()
    h.failRespond = true
    await expect(store.resolveRequest('r1', true)).rejects.toThrow()
    expect(store.getNotificationsSnapshot().requests).toHaveLength(1)
  })

  it('markActivityRead marks unread rows read and calls the RPC with their ids', async () => {
    h.activity = [act('n1', false), act('n2', true)]
    await store.loadNotifications()
    await store.markActivityRead()
    expect(store.getNotificationsSnapshot().activity.every((a) => a.readAt !== null)).toBe(true)
    expect(h.markCalls).toEqual([['n1']])
  })
})
