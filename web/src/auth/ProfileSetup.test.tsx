import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  saveProfile: vi.fn(async () => {}),
  isHandleAvailable: vi.fn(async () => true),
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ saveProfile: h.saveProfile, isHandleAvailable: h.isHandleAvailable }),
}))

const { ProfileSetup } = await import('./ProfileSetup')

afterEach(() => {
  vi.clearAllMocks()
})

async function fillValidHandle() {
  fireEvent.change(screen.getByPlaceholderText('handle'), { target: { value: 'bruno' } })
  // Wait for the debounced availability check to resolve.
  await screen.findByText('Available')
}

describe('ProfileSetup privacy gate', () => {
  it('keeps Save disabled until a privacy choice is made', async () => {
    render(<ProfileSetup onDone={() => {}} />)
    await fillValidHandle()
    // Handle is available but no privacy chosen yet → still disabled.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Public/ }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('passes the private choice through to saveProfile', async () => {
    render(<ProfileSetup onDone={() => {}} />)
    await fillValidHandle()
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Bruno' } })
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.saveProfile).toHaveBeenCalledWith('bruno', 'Bruno', undefined, true))
  })
})
