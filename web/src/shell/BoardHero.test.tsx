import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { BoardInstance, SharedBoardMirror } from '../board/boardInstance'

const h = vi.hoisted(() => ({
  ascents: [] as unknown[],
  recents: [] as string[],
  resolved: null as unknown,
}))

// The logbook store and the per-slab recents history are the hero's two content sources.
vi.mock('../logbook/ascents', () => ({
  useEnsureAscentsLoaded: () => ({ status: 'loaded', ascents: h.ascents, error: null }),
}))
vi.mock('../catalog/recentsStore', () => ({
  useRecents: () => h.recents,
}))
vi.mock('../catalog/useResolvedProblem', () => ({
  useResolvedProblem: (id: string | null) => (id === null ? null : h.resolved),
}))

import { BoardHero } from './BoardHero'

const masters = boardByLayoutId(5)! // angles [40, 25]
const mini = boardByLayoutId(7)! // angles [40] — no angle choice

const local = (layout = masters): BoardInstance => ({
  instanceId: String(layout.layoutId),
  layoutId: layout.layoutId,
  layout,
})

const shared = (over: Partial<SharedBoardMirror> = {}): BoardInstance => ({
  instanceId: 'S:b1',
  layoutId: masters.layoutId,
  layout: masters,
  shared: {
    boardId: 'b1',
    role: 'member',
    name: 'Gym wall',
    layoutId: 5,
    angleMode: 'fixed',
    canonicalAngle: 25,
    canonicalHoldSetsRaw: '',
    ...over,
  },
})

const ascent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  date: '2026-07-20T10:00:00Z',
  sourceCatalogId: 'p-1',
  userProblemId: null,
  problemName: 'Shark Attack',
  problemGrade: '7A',
  votedGrade: '',
  tries: 2,
  stars: 3,
  comment: '',
  sent: true,
  boardLayoutId: 5,
  ...over,
})

const noop = () => {}

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
  h.ascents = []
  h.recents = []
  h.resolved = null
})

describe('BoardHero', () => {
  it('renders the board name, its angle, and the hold-set summary', () => {
    render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
    expect(screen.getByRole('heading', { name: 'MoonBoard Masters 2019' })).toBeInTheDocument()
    expect(screen.getByText(/40°/)).toBeInTheDocument()
    expect(screen.getByText(/All hold sets/)).toBeInTheDocument()
  })

  it('omits the angle for a single-angle board, which has no choice to state', () => {
    render(<BoardHero instance={local(mini)} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
    expect(screen.queryByText(/40°/)).toBeNull()
    expect(screen.getByText('All hold sets')).toBeInTheDocument()
  })

  it('names a shared board by its owner-set name, not the layout name', () => {
    render(<BoardHero instance={shared()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
    expect(screen.getByRole('heading', { name: 'Gym wall' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'MoonBoard Masters 2019' })).toBeNull()
  })

  it('offers Browse and Set up, and calls back on each', () => {
    const onBrowse = vi.fn()
    const onSetUp = vi.fn()
    render(<BoardHero instance={local()} onBrowse={onBrowse} onSetUp={onSetUp} sharingAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }))
    expect(onBrowse).toHaveBeenCalledTimes(1)
    expect(onSetUp).toHaveBeenCalledTimes(1)
  })

  it('renders no share affordance at all while sharing is unavailable', () => {
    render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    expect(screen.queryByText(/share/i)).toBeNull()
  })

  describe('personal activity', () => {
    it('renders the most recent send, not merely the first ascent in the list', async () => {
      h.ascents = [
        ascent({ id: 'old', date: '2026-07-01T10:00:00Z', problemName: 'Old One' }),
        ascent({ id: 'new', date: '2026-07-22T10:00:00Z', problemName: 'Newest One' }),
        ascent({ id: 'mid', date: '2026-07-10T10:00:00Z', problemName: 'Middle One' }),
      ]
      render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
      expect(await screen.findByText('Newest One')).toBeInTheDocument()
      expect(screen.queryByText('Old One')).toBeNull()
    })

    it('survives a cold load — the sources are persisted, not session-scoped', async () => {
      // Nothing has been opened in *this* session; both values still render because the
      // logbook store and the recents history are read from persistence, not memory.
      h.ascents = [ascent()]
      h.recents = ['p-9']
      h.resolved = { source_catalog_id: 'p-9', name: 'Cold Start', grade: '6C', holds: [] }
      render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
      expect(await screen.findByText('Shark Attack')).toBeInTheDocument()
      expect(screen.getByText('Cold Start')).toBeInTheDocument()
    })

    it('ignores unsent attempts and other boards’ ascents', () => {
      h.ascents = [
        ascent({ id: 'attempt', sent: false, problemName: 'Not Sent' }),
        ascent({ id: 'elsewhere', boardLayoutId: 7, problemName: 'Other Board' }),
      ]
      render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
      expect(screen.queryByText('Not Sent')).toBeNull()
      expect(screen.queryByText('Other Board')).toBeNull()
      expect(screen.queryByText('Last send')).toBeNull()
    })

    it('keeps the viewer’s own content on a shared board, alongside the social region', async () => {
      h.ascents = [ascent()]
      h.recents = ['p-9']
      h.resolved = { source_catalog_id: 'p-9', name: 'Cold Start', grade: '6C', holds: [] }
      render(<BoardHero instance={shared()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
      expect(await screen.findByText('Shark Attack')).toBeInTheDocument()
      expect(screen.getByText('Cold Start')).toBeInTheDocument()
    })

    it('renders nothing rather than an empty shell when there is no activity', async () => {
      render(<BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />)
      await waitFor(() => expect(screen.queryByText('Last send')).toBeNull())
      expect(screen.queryByText('Last opened')).toBeNull()
    })
  })

  it('caps the board art’s height via an aspect-derived max-width', () => {
    // The art must not push the actions and everything below out of the first viewport on
    // a 375px phone, and a tall board has to letterbox narrower rather than overflow.
    const { container } = render(
      <BoardHero instance={local()} onBrowse={noop} onSetUp={noop} sharingAvailable={false} />,
    )
    const capped = container.querySelector('[style*="max-width"]') as HTMLElement
    expect(capped).toBeTruthy()
    expect(capped.style.maxWidth).toContain('vh')
    expect(capped.style.maxWidth).toContain(String(masters.geometry.width))
    expect(capped.style.maxWidth).toContain(String(masters.geometry.height))
  })
})
