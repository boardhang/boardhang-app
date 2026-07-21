import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { NotificationsState } from './notificationsStore'
import type { FollowRequest, NotificationItem } from './socialTypes'

const h = vi.hoisted(() => ({ state: null as NotificationsState | null }))

vi.mock('./notificationsStore', () => ({
  useNotifications: () => h.state,
  loadNotifications: vi.fn(async () => {}),
  markActivityRead: vi.fn(async () => {}),
  resolveRequest: vi.fn(async () => {}),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const { resolveRequest } = await import('./notificationsStore')
const { NotificationsScreen } = await import('./NotificationsScreen')

function state(partial: Partial<NotificationsState>): NotificationsState {
  return { status: 'loaded', requests: [], activity: [], ...partial }
}
const request: FollowRequest = {
  id: 'r1',
  handle: 'bruno',
  displayName: 'Bruno',
  avatarUrl: null,
  isPrivate: false,
  requestedAt: '2026-07-20T00:00:00Z',
}
const activityItem: NotificationItem = {
  id: 'n1',
  type: 'follow',
  actorId: 'a1',
  handle: 'ana',
  displayName: 'Ana',
  avatarUrl: null,
  createdAt: '2026-07-20T00:00:00Z',
  readAt: null,
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('NotificationsScreen', () => {
  it('shows the empty state when there is nothing', () => {
    h.state = state({})
    render(<NotificationsScreen />)
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
  })

  it('renders a request with Approve/Decline and approves on click', () => {
    h.state = state({ requests: [request] })
    render(<NotificationsScreen />)
    expect(screen.getByText('@bruno · wants to follow you')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(resolveRequest).toHaveBeenCalledWith('r1', true)
  })

  it('renders an activity row with the follow verb', () => {
    h.state = state({ activity: [activityItem] })
    render(<NotificationsScreen />)
    expect(screen.getByText('started following you')).toBeInTheDocument()
  })
})
