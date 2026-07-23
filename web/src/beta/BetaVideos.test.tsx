import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { BetaEntry } from './betaStore'
import type { BetaVideo } from './betaTypes'

// Drive the section by store state; submitBeta is unused in these cases.
let entry: BetaEntry = { status: 'loading', videos: [], error: null }
const refetch = vi.fn()
vi.mock('./betaStore', () => ({
  useBetaVideos: () => entry,
  refetchBeta: (id: string) => refetch(id),
  submitBeta: vi.fn(),
}))

// Mutable auth so we can flip signed-out -> signed-in to exercise the resume effect.
const authStatus = { value: 'signedOut' as string }
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: authStatus.value }) }))

// Open-state-exposing stubs so tests can assert which surface is showing without pulling in the
// real dialog/drawer internals.
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="signin" /> : null),
}))
vi.mock('./BetaSubmitDialog', () => ({
  BetaSubmitDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="submit-dialog" /> : null),
}))

import { BetaVideos } from './BetaVideos'

function vid(id: string, isMine = false): BetaVideo {
  return {
    id, source_catalog_id: 'p', provider: 'youtube', video_id: id,
    title: id, channel: `Chan ${id}`, duration_s: 30, is_short: true, views: 1, isMine,
  }
}

beforeEach(() => {
  entry = { status: 'loading', videos: [], error: null }
  authStatus.value = 'signedOut'
  localStorage.clear()
  vi.clearAllMocks()
})

describe('BetaVideos display states', () => {
  it('shows the empty state when there are no betas', () => {
    entry = { status: 'ready', videos: [], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByText('No beta videos yet.')).toBeTruthy()
  })

  it('renders a labelled card per video', () => {
    entry = { status: 'ready', videos: [vid('a'), vid('b')], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByLabelText(/Beta by Chan a/)).toBeTruthy()
    expect(screen.getByLabelText(/Beta by Chan b/)).toBeTruthy()
  })

  it('offers Try again on error', () => {
    entry = { status: 'error', videos: [], error: 'boom' }
    render(<BetaVideos sourceCatalogId="p" />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledWith('p')
  })
})

describe('BetaVideos "Added by you" badge', () => {
  it('badges the viewer\'s own clip and reflects it in the card label', () => {
    entry = { status: 'ready', videos: [vid('mine', true)], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByText('Added by you')).toBeTruthy()
    expect(screen.getByLabelText(/added by you/i)).toBeTruthy()
  })

  it('shows no badge on a clip the viewer does not own', () => {
    entry = { status: 'ready', videos: [vid('other', false)], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.queryByText('Added by you')).toBeNull()
    expect(screen.getByLabelText('Beta by Chan other, 0:30')).toBeTruthy() // label unmodified
  })

  it('renders the store order as-is (own-first comes from the store, not the component)', () => {
    // The store already returns mine-first; the strip must not re-order.
    entry = { status: 'ready', videos: [vid('mine', true), vid('other', false)], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    const labels = screen.getAllByLabelText(/Beta by/).map((el) => el.getAttribute('aria-label'))
    expect(labels[0]).toMatch(/Chan mine.*added by you/)
    expect(labels[1]).toMatch(/Chan other/)
  })
})

describe('BetaVideos pending-review note (#2)', () => {
  it('shows a pending card for a fresh pending mark', () => {
    localStorage.setItem('beta-pending:p', JSON.stringify({ videoId: 'x', ts: Date.now() }))
    entry = { status: 'ready', videos: [], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByText(/pending review/i)).toBeTruthy()
  })

  it('renders the pending card alongside existing approved videos', () => {
    localStorage.setItem('beta-pending:p', JSON.stringify({ videoId: 'x', ts: Date.now() }))
    entry = { status: 'ready', videos: [vid('a')], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByText(/pending review/i)).toBeTruthy() // the pending card
    expect(screen.getByLabelText(/Beta by Chan a/)).toBeTruthy() // the approved card
  })

  it('hides (and clears) an expired mark', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    localStorage.setItem('beta-pending:p', JSON.stringify({ videoId: 'x', ts: eightDaysAgo }))
    entry = { status: 'ready', videos: [], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.queryByText(/pending review/i)).toBeNull()
    expect(localStorage.getItem('beta-pending:p')).toBeNull() // readPending prunes it
  })

  it('clears the note once the submitted clip appears approved', () => {
    localStorage.setItem('beta-pending:p', JSON.stringify({ videoId: 'vid1', ts: Date.now() }))
    entry = { status: 'ready', videos: [vid('vid1')], error: null } // that clip is now approved
    render(<BetaVideos sourceCatalogId="p" />)
    expect(screen.queryByText(/pending review/i)).toBeNull()
    expect(localStorage.getItem('beta-pending:p')).toBeNull()
  })
})

describe('BetaVideos submit gate + resume (#7)', () => {
  it('signed-out tap opens sign-in, not the drawer', () => {
    entry = { status: 'ready', videos: [], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    fireEvent.click(screen.getByRole('button', { name: /add a beta/i }))
    expect(screen.getByTestId('signin')).toBeTruthy()
    expect(screen.queryByTestId('submit-dialog')).toBeNull()
  })

  it('reopens the submit drawer once sign-in lands (resume)', () => {
    entry = { status: 'ready', videos: [], error: null }
    const { rerender } = render(<BetaVideos sourceCatalogId="p" />)
    fireEvent.click(screen.getByRole('button', { name: /add a beta/i }))
    expect(screen.queryByTestId('submit-dialog')).toBeNull()
    // Session lands: the resume effect should auto-open the drawer.
    act(() => {
      authStatus.value = 'signedInWithProfile'
    })
    rerender(<BetaVideos sourceCatalogId="p" />)
    expect(screen.getByTestId('submit-dialog')).toBeTruthy()
  })

  it('signed-in tap opens the drawer directly', () => {
    authStatus.value = 'signedInWithProfile'
    entry = { status: 'ready', videos: [], error: null }
    render(<BetaVideos sourceCatalogId="p" />)
    fireEvent.click(screen.getByRole('button', { name: /add a beta/i }))
    expect(screen.getByTestId('submit-dialog')).toBeTruthy()
  })
})
