import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// Controllable RPC layer + a signed-in identity. PersonRow is stubbed to just its handle so
// this test isolates DiscoverScreen's search states + section logic (no router/RelationshipButton).
const h = vi.hoisted(() => ({
  profiles: [] as { id: string; handle: string; display_name: string; avatar_url: null; is_private: boolean; edge_status: string | null }[],
  coMembers: [] as { id: string; handle: string; display_name: string; avatar_url: null; is_private: boolean }[],
  followers: [] as { id: string; handle: string; display_name: string; avatar_url: null; is_private: boolean }[],
  following: [] as { id: string; handle: string; display_name: string; avatar_url: null; is_private: boolean }[],
}))

vi.mock('../supabase/client', () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'search_profiles') {
        const q = (args.p_q as string).toLowerCase()
        return { data: h.profiles.filter((p) => p.handle.toLowerCase().startsWith(q)), error: null }
      }
      if (name === 'suggest_co_members') return { data: h.coMembers, error: null }
      if (name === 'get_follow_list') {
        return { data: args.p_kind === 'followers' ? h.followers : h.following, error: null }
      }
      return { data: [], error: null }
    },
  },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))
vi.mock('./followStore', () => ({ seedEdge: vi.fn() }))
vi.mock('./PersonRow', () => ({
  PersonRow: ({ card }: { card: { handle: string } }) => <div>@{card.handle}</div>,
}))

const { DiscoverScreen } = await import('./DiscoverScreen')

function card(id: string, handle: string) {
  return { id, handle, display_name: handle, avatar_url: null, is_private: false }
}

beforeEach(() => {
  h.profiles = []
  h.coMembers = []
  h.followers = []
  h.following = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DiscoverScreen', () => {
  it('shows a min-length hint for a 1-char query', async () => {
    render(<DiscoverScreen />)
    fireEvent.change(screen.getByLabelText('Search for people'), { target: { value: 'a' } })
    expect(await screen.findByText('Type at least 2 characters.')).toBeInTheDocument()
  })

  it('renders search results for a matching prefix', async () => {
    h.profiles = [{ ...card('u1', 'bruno'), edge_status: null }]
    render(<DiscoverScreen />)
    fireEvent.change(screen.getByLabelText('Search for people'), { target: { value: 'br' } })
    expect(await screen.findByText('@bruno')).toBeInTheDocument()
  })

  it('shows the no-results empty state for a non-matching query', async () => {
    h.profiles = []
    render(<DiscoverScreen />)
    fireEvent.change(screen.getByLabelText('Search for people'), { target: { value: 'zz' } })
    expect(await screen.findByText('No one found.')).toBeInTheDocument()
  })

  it('lists co-members and non-reciprocated followers when the query is empty', async () => {
    h.coMembers = [card('c1', 'climbpal')]
    h.followers = [card('f1', 'fan'), card('f2', 'mutual')]
    h.following = [card('f2', 'mutual')] // f2 already followed → not a follow-back candidate
    render(<DiscoverScreen />)
    expect(await screen.findByText('People you climb with')).toBeInTheDocument()
    expect(await screen.findByText('@climbpal')).toBeInTheDocument()
    expect(await screen.findByText('@fan')).toBeInTheDocument()
    // The already-followed mutual is filtered out of Follow back.
    expect(screen.queryByText('@mutual')).not.toBeInTheDocument()
  })
})
