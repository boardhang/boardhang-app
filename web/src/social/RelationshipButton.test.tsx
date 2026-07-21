import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProfileCard } from './socialTypes'

// Control the edge the button reads, and spy on the mutations it calls.
const s = vi.hoisted(() => ({ status: 'none' as 'none' | 'pending' | 'active', blocked: false }))
vi.mock('./followStore', () => ({
  useEdge: () => ({ status: s.status, blocked: s.blocked }),
  follow: vi.fn(async () => {}),
  unfollow: vi.fn(async () => {}),
}))

const { follow, unfollow } = await import('./followStore')
const { RelationshipButton } = await import('./RelationshipButton')

const target: ProfileCard = {
  id: 'u1',
  handle: 'bruno',
  displayName: 'Bruno',
  avatarUrl: null,
  isPrivate: false,
}

beforeEach(() => {
  s.status = 'none'
  s.blocked = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RelationshipButton', () => {
  it('shows Follow for no edge and follows on click', async () => {
    render(<RelationshipButton target={target} />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(follow).toHaveBeenCalledWith('u1', false)
  })

  it('shows Requested for a pending edge and cancels on click', async () => {
    s.status = 'pending'
    render(<RelationshipButton target={target} />)
    fireEvent.click(screen.getByRole('button', { name: 'Requested' }))
    expect(unfollow).toHaveBeenCalledWith('u1')
  })

  it('shows Following and unfollows only after confirming', async () => {
    s.status = 'active'
    render(<RelationshipButton target={target} />)
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))
    // A confirm dialog appears; unfollow is not called until confirmed.
    expect(unfollow).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('button', { name: 'Unfollow' })
    fireEvent.click(confirm)
    await waitFor(() => expect(unfollow).toHaveBeenCalledWith('u1'))
  })

  it('passes the private hint through when following a private account', async () => {
    render(<RelationshipButton target={{ ...target, isPrivate: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(follow).toHaveBeenCalledWith('u1', true)
  })
})
