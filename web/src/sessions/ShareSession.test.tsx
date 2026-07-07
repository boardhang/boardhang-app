import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getInviteToken: vi.fn() }))
vi.mock('./sessionsStore', () => ({ getInviteToken: (...a: unknown[]) => h.getInviteToken(...a) }))

import { ShareSession } from './ShareSession'

beforeEach(() => {
  h.getInviteToken.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
  // No native share in jsdom → the button falls back to Copy.
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShareSession', () => {
  it('renders a QR of the join link and copies it with a confirmation', async () => {
    h.getInviteToken.mockResolvedValue('tok-abc')
    render(<ShareSession />)
    const qr = await screen.findByRole('img', { name: 'Session join QR code' })
    expect(qr.querySelector('svg')).toBeTruthy()
    expect(screen.getByText(/\/session\/join\/tok-abc/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/session/join/tok-abc'))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('shows an error + retry when the token fetch fails, then recovers', async () => {
    h.getInviteToken.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('tok-xyz')
    render(<ShareSession />)
    expect(await screen.findByText(/couldn’t load the share link/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('img', { name: 'Session join QR code' })).toBeInTheDocument()
  })
})
