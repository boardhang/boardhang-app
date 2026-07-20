import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SendRow } from './socialTypes'

// get_user_sends returns queued pages in order; `error` forces a fetch failure.
const h = vi.hoisted(() => ({ pages: [] as (SendRow[] | 'error')[] }))

vi.mock('../supabase/client', () => ({
  supabase: {
    rpc: async () => {
      const next = h.pages.shift()
      if (next === undefined || next === 'error') return { data: null, error: { message: 'x' } }
      return { data: next, error: null }
    },
  },
}))

const { UserSendsList } = await import('./UserSendsList')

function row(id: string): SendRow {
  return {
    ascent_id: id,
    actor_id: 'u1',
    handle: 'u',
    display_name: 'U',
    avatar_url: null,
    source_catalog_id: 'p',
    user_problem_id: null,
    problem_name: `Prob ${id}`,
    problem_grade: 'V5',
    board_layout_id: 7,
    climbed_at: new Date().toISOString(),
    first_sent_at: new Date().toISOString(),
  }
}
const fullPage = (seed: string) => Array.from({ length: 30 }, (_, i) => row(`${seed}-${i}`))

beforeEach(() => {
  h.pages = []
})
afterEach(() => vi.clearAllMocks())

describe('UserSendsList', () => {
  it('renders sends and hides "Load more" on a short (final) page', async () => {
    h.pages = [[row('a'), row('b')]]
    render(<UserSendsList userId="u1" />)
    expect(await screen.findByText('Prob a')).toBeInTheDocument()
    expect(screen.getByText('2 sends')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('keyset-paginates: "Load more" appends the next page then terminates on a short page', async () => {
    h.pages = [fullPage('p0'), [row('extra')]]
    render(<UserSendsList userId="u1" />)
    await screen.findByText('Prob p0-0')
    const more = screen.getByRole('button', { name: 'Load more' }) // full first page → more available
    fireEvent.click(more)
    expect(await screen.findByText('Prob extra')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    )
  })

  it('shows the empty state', async () => {
    h.pages = [[]]
    render(<UserSendsList userId="u1" />)
    expect(await screen.findByText('No sends to show.')).toBeInTheDocument()
  })

  it('shows the error state on a failed fetch', async () => {
    h.pages = ['error']
    render(<UserSendsList userId="u1" />)
    expect(await screen.findByText("Couldn't load sends.")).toBeInTheDocument()
  })
})
