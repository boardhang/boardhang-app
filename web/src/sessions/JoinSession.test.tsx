import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  token: 'tok-abc',
  status: 'signedInWithProfile' as string,
  navigate: vi.fn(),
  joinSession: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    getRouteApi: () => ({ useParams: () => ({ token: h.token }) }),
    useNavigate: () => h.navigate,
  }
})
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: h.status, isRestoring: false }) }))
vi.mock('../auth/SignInPanel', () => ({ SignInPanel: () => <div>sign-in-panel</div> }))
vi.mock('./sessionsStore', () => ({ joinSession: (...a: unknown[]) => h.joinSession(...a) }))

import { JoinSession } from './JoinSession'

beforeEach(() => {
  h.token = 'tok-abc'
  h.status = 'signedInWithProfile'
  h.navigate.mockClear()
  h.joinSession.mockReset().mockResolvedValue({ id: 'S1', boardLayoutId: 7 })
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('JoinSession', () => {
  it('shows the sign-in gate when signed out and persists the pending token', () => {
    h.status = 'signedOut'
    render(<JoinSession />)
    expect(screen.getByText('sign-in-panel')).toBeInTheDocument()
    expect(sessionStorage.getItem('pendingJoinToken')).toBe('tok-abc')
  })

  it('shows the honest-visibility consent notice and joins into the board catalog', async () => {
    render(<JoinSession />)
    expect(screen.getByText(/sent or tried/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Join session' }))
    await waitFor(() => expect(h.joinSession).toHaveBeenCalledWith('tok-abc'))
    await waitFor(() => expect(h.navigate).toHaveBeenCalled())
    // clears the pending token once signed in
    expect(sessionStorage.getItem('pendingJoinToken')).toBeNull()
  })

  it('shows a friendly error for an expired/invalid token (no dead end)', async () => {
    h.joinSession.mockRejectedValue(new Error('session not found, ended, or expired'))
    render(<JoinSession />)
    fireEvent.click(screen.getByRole('button', { name: 'Join session' }))
    expect(await screen.findByText('Session unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /go to my boards/i }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards' })
  })

  it('declining does not join and routes away', () => {
    render(<JoinSession />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(h.joinSession).not.toHaveBeenCalled()
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards' })
  })
})
