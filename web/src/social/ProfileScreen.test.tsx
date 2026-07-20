import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  handle: 'bruno',
  card: null as Record<string, unknown> | null,
  counts: null as { followers: number; following: number } | null,
}))

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ handle: h.handle }) }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))
vi.mock('../supabase/client', () => ({
  supabase: {
    rpc: async (name: string) => {
      if (name === 'get_profile_card') return { data: h.card ? [h.card] : [], error: null }
      if (name === 'get_follow_counts') return { data: h.counts ? [h.counts] : [], error: null }
      return { data: [], error: null }
    },
  },
}))
vi.mock('./followStore', () => ({
  useEdge: () => ({ status: 'none', blocked: false }),
  loadEdge: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
}))
vi.mock('./UserSendsList', () => ({ UserSendsList: () => <div>sends</div> }))
vi.mock('./RelationshipButton', () => ({ RelationshipButton: () => <button>Follow</button> }))

const { ProfileScreen } = await import('./ProfileScreen')

beforeEach(() => {
  h.handle = 'bruno'
  h.card = { id: 'u1', handle: 'bruno', display_name: 'Bruno', avatar_url: null, is_private: false }
  h.counts = { followers: 3, following: 5 }
})
afterEach(() => vi.clearAllMocks())

describe('ProfileScreen', () => {
  it('renders the header + counts for a resolvable profile', async () => {
    render(<ProfileScreen />)
    expect(await screen.findByText('@bruno')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // followers
    expect(screen.getByText('5')).toBeInTheDocument() // following
    expect(screen.getByText('sends')).toBeInTheDocument()
  })

  it('renders the "unavailable" state when the card comes back empty (blocked / missing)', async () => {
    h.card = null
    render(<ProfileScreen />)
    expect(await screen.findByText('This account is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('sends')).not.toBeInTheDocument()
  })
})
