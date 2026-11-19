import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ activeSession: null as unknown, navigate: vi.fn() }))
vi.mock('@tanstack/react-router', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useNavigate: () => h.navigate,
}))
vi.mock('../sessions/sessionsStore', () => ({
  useSessions: () => ({ activeSession: h.activeSession }),
}))
vi.mock('../sessions/ScanToJoin', () => ({
  ScanToJoinButton: (p: { children: React.ReactNode }) => <button>{p.children}</button>,
}))

import { FirstBoard } from './FirstBoard'

beforeEach(() => {
  h.activeSession = null
  h.navigate.mockClear()
})

describe('FirstBoard', () => {
  it('shows one card with one "Add a board" button', () => {
    render(<FirstBoard />)
    expect(screen.getByRole('heading', { name: 'Add your first board' })).toBeInTheDocument()
    expect(screen.getByText('Pick the board you climb on, its angle and its hold sets.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add a board' })).toHaveLength(1)
  })

  it('opens the add flow from the button', () => {
    render(<FirstBoard />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a board' }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/boards/add' })
  })

  it('shows the scan row below the card', () => {
    render(<FirstBoard />)
    const scan = screen.getByRole('button', { name: /Scan a QR code/ })
    expect(scan).toHaveTextContent('Join a session a friend started')
    const add = screen.getByRole('button', { name: 'Add a board' })
    expect(add.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the scan row while a session is active', () => {
    h.activeSession = { id: 'S1', boardLayoutId: 7 }
    render(<FirstBoard />)
    expect(screen.queryByRole('button', { name: /Scan a QR code/ })).toBeNull()
  })
})
