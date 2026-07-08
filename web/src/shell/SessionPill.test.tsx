import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sessions: { activeSession: null as unknown, roster: [] as unknown[], selfId: null as string | null },
  leaveSession: vi.fn(),
}))
vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => h.sessions,
  leaveSession: () => h.leaveSession(),
}))
vi.mock('../sessions/ShareSession', () => ({ ShareSession: () => <div>share-surface</div> }))

import { SessionPill } from './SessionPill'

const activeWith = (selfId: string, roster: unknown[]) => ({
  activeSession: { id: 'S1', name: 'Crew', ownerId: 'owner', boardLayoutId: 7 },
  roster,
  selfId,
})

beforeEach(() => {
  h.sessions = { activeSession: null, roster: [], selfId: null }
  h.leaveSession.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('SessionPill', () => {
  it('renders nothing without an active session', () => {
    const { container } = render(<SessionPill />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is suppressed on the catalog route', () => {
    h.sessions = activeWith('owner', [{ userId: 'owner', joinedAt: '', handle: 'o', displayName: 'Owner' }])
    const { container } = render(<SessionPill suppressed />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens a panel with the roster (AvatarGroup) + Leave; no Remove here (it lives in the bar)', () => {
    h.sessions = activeWith('bob', [
      { userId: 'owner', joinedAt: '', handle: 'alice', displayName: 'Alice' },
      { userId: 'bob', joinedAt: '', handle: 'bob', displayName: 'Bob' },
    ])
    render(<SessionPill />)
    fireEvent.click(screen.getByRole('button', { name: /Crew/ }))
    // Members render as avatars whose hover title is the member (self = "You").
    expect(screen.getByTitle('You')).toBeInTheDocument()
    expect(screen.getByTitle('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Leave session' }))
    expect(h.leaveSession).toHaveBeenCalled()
  })
})
