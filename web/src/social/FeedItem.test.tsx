import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { SendItem } from './socialTypes'

const nav = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.fn }))
vi.mock('../catalog/catalogNav', () => ({
  catalogNavTarget: () => ({ to: '/board/$layoutId/catalog', params: { layoutId: '7' }, search: {} }),
}))

const { FeedItem } = await import('./FeedItem')

function send(over: Partial<SendItem> = {}): SendItem {
  return {
    ascentId: 's1',
    actorId: 'a1',
    handle: 'ana',
    displayName: 'Ana',
    avatarUrl: null,
    sourceCatalogId: 'p1',
    userProblemId: null,
    problemName: 'Prob',
    problemGrade: 'V5',
    boardLayoutId: 7, // Mini MoonBoard 2025 — resolvable
    climbedAt: new Date().toISOString(),
    firstSentAt: new Date().toISOString(),
    ...over,
  }
}

afterEach(() => vi.clearAllMocks())

describe('FeedItem', () => {
  it('a catalog send is clickable and opens the problem', () => {
    render(<FeedItem send={send()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(nav.fn).toHaveBeenCalledWith(expect.objectContaining({ search: { problem: 'p1' } }))
  })

  it('a user-problem send (no catalog id) renders a non-clickable row, not a throw', () => {
    render(<FeedItem send={send({ sourceCatalogId: null, userProblemId: 'up1' })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Prob')).toBeInTheDocument()
  })

  it('a send whose board layout is unresolvable is not clickable', () => {
    render(<FeedItem send={send({ boardLayoutId: 999 })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
