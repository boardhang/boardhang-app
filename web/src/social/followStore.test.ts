import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Stateful supabase mock: a tiny follow graph + the 0017 RPCs. request_follow returns the
//    resulting edge (pending for a private/unchosen target, active otherwise); unfollow/block
//    mutate the graph; a `fail` flag forces a cloud error to exercise optimistic rollback. ──
const h = vi.hoisted(() => ({
  userId: 'me' as string | null,
  privateTargets: new Set<string>(), // targets that land `pending`
  edges: new Map<string, string>(), // `${follower}->${followee}` -> status
  blocks: new Set<string>(),
  fail: false,
}))

vi.mock('../supabase/client', () => {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (h.fail) return { data: null, error: { message: 'network down' } }
    const me = h.userId as string
    if (name === 'request_follow') {
      const t = args.p_target as string
      const status = h.privateTargets.has(t) ? 'pending' : 'active'
      h.edges.set(`${me}->${t}`, status)
      return { data: { follower_id: me, followee_id: t, status }, error: null }
    }
    if (name === 'unfollow') {
      h.edges.delete(`${me}->${args.p_target as string}`)
      return { data: null, error: null }
    }
    if (name === 'block_user') {
      const t = args.p_target as string
      h.edges.delete(`${me}->${t}`)
      h.edges.delete(`${t}->${me}`)
      h.blocks.add(`${me}->${t}`)
      return { data: null, error: null }
    }
    if (name === 'unblock_user') {
      h.blocks.delete(`${me}->${args.p_target as string}`)
      return { data: null, error: null }
    }
    if (name === 'respond_to_follow') {
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  // Minimal PostgREST builder for from('follows').select('status').eq().eq().maybeSingle().
  const from = () => {
    const ctx: { follower?: string; followee?: string } = {}
    const builder = {
      select: () => builder,
      eq: (col: string, val: string) => {
        if (col === 'follower_id') ctx.follower = val
        if (col === 'followee_id') ctx.followee = val
        return builder
      },
      maybeSingle: async () => {
        const status = h.edges.get(`${ctx.follower}->${ctx.followee}`)
        return { data: status ? { status } : null, error: null }
      },
    }
    return builder
  }

  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: h.userId ? { user: { id: h.userId } } : null } }) },
      rpc,
      from,
    },
  }
})

// Import AFTER the mock is registered.
const { follow, unfollow, block, loadEdge, getEdge, resetFollowsForTest } = await import('./followStore')

beforeEach(() => {
  h.userId = 'me'
  h.privateTargets = new Set()
  h.edges = new Map()
  h.blocks = new Set()
  h.fail = false
  resetFollowsForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('followStore', () => {
  it('following a public account lands active', async () => {
    await follow('pub', false)
    expect(getEdge('pub').status).toBe('active')
  })

  it('following a private account lands pending (server-authoritative)', async () => {
    h.privateTargets.add('priv')
    // Even with an optimistic "active" hint, the server reconciles to pending.
    await follow('priv', true)
    expect(getEdge('priv').status).toBe('pending')
  })

  it('rolls back to none and throws when the follow RPC fails', async () => {
    h.fail = true
    await expect(follow('pub', false)).rejects.toThrow()
    expect(getEdge('pub').status).toBe('none')
  })

  it('unfollow returns the edge to none', async () => {
    await follow('pub', false)
    await unfollow('pub')
    expect(getEdge('pub').status).toBe('none')
  })

  it('a failed unfollow rolls back to the prior status', async () => {
    await follow('pub', false)
    h.fail = true
    await expect(unfollow('pub')).rejects.toThrow()
    expect(getEdge('pub').status).toBe('active')
  })

  it('block clears the edge and marks blocked', async () => {
    await follow('pub', false)
    await block('pub')
    const e = getEdge('pub')
    expect(e.status).toBe('none')
    expect(e.blocked).toBe(true)
  })

  it('loadEdge reflects an existing edge from the graph', async () => {
    h.edges.set('me->x', 'active')
    await loadEdge('x')
    expect(getEdge('x').status).toBe('active')
  })
})
