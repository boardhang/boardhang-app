import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sessions: { activeSession: null as unknown, roster: [] as unknown[], selfId: null as string | null },
  leaveSession: vi.fn(),
  removeMember: vi.fn(),
}))
vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => h.sessions,
  leaveSession: () => h.leaveSession(),
  removeMember: (...a: unknown[]) => h.removeMember(...a),
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
  h.removeMember.mockClear()
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

  it('opens a panel with roster + Leave; a non-owner sees no Remove', () => {
    h.sessions = activeWith('bob', [
      { userId: 'owner', joinedAt: '', handle: 'alice', displayName: 'Alice' },
      { userId: 'bob', joinedAt: '', handle: 'bob', displayName: 'Bob' },
    ])
    render(<SessionPill />)
    fireEvent.click(screen.getByRole('button', { name: /Crew/ }))
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Leave session' }))
    expect(h.leaveSession).toHaveBeenCalled()
  })

  it('lets the owner remove another member (KTD-11)', () => {
    h.sessions = activeWith('owner', [
      { userId: 'owner', joinedAt: '', handle: 'owner', displayName: 'Owner' },
      { userId: 'bob', joinedAt: '', handle: 'bob', displayName: 'Bob' },
    ])
    render(<SessionPill />)
    fireEvent.click(screen.getByRole('button', { name: /Crew/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }))
    expect(h.removeMember).toHaveBeenCalledWith('bob')
  })
})
