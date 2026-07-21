import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  status: 'signedInWithProfile' as string,
  privacyChoiceAt: null as string | null,
  setPrivacyChoice: vi.fn(async () => {}),
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    status: h.status,
    profile: { id: 'me', handle: 'me', displayName: 'Me', privacyChoiceAt: h.privacyChoiceAt },
    setPrivacyChoice: h.setPrivacyChoice,
  }),
}))

const { PrivacyChoiceNotice } = await import('./PrivacyChoiceNotice')

afterEach(() => {
  h.status = 'signedInWithProfile'
  h.privacyChoiceAt = null
  vi.clearAllMocks()
})

describe('PrivacyChoiceNotice', () => {
  it('does not show once a choice has been made', () => {
    h.privacyChoiceAt = '2026-07-20T00:00:00Z'
    render(<PrivacyChoiceNotice />)
    expect(screen.queryByText('Your climbing activity can now be followed')).not.toBeInTheDocument()
  })

  it('does not show for a signed-out user', () => {
    h.status = 'signedOut'
    render(<PrivacyChoiceNotice />)
    expect(screen.queryByText('Your climbing activity can now be followed')).not.toBeInTheDocument()
  })

  it('shows a non-dismissible forced choice for an unchosen existing user', () => {
    render(<PrivacyChoiceNotice />)
    expect(screen.getByText('Your climbing activity can now be followed')).toBeInTheDocument()
    // Non-dismissible: no Close affordance, and Continue is disabled until a choice is made.
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('records a public choice', () => {
    render(<PrivacyChoiceNotice />)
    fireEvent.click(screen.getByRole('radio', { name: /Public/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(h.setPrivacyChoice).toHaveBeenCalledWith(false)
  })

  it('records a private choice', () => {
    render(<PrivacyChoiceNotice />)
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(h.setPrivacyChoice).toHaveBeenCalledWith(true)
  })
})
