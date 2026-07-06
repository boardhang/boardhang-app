import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from './test/renderWithRouter'
import { addBoard, getAddedBoardIds, getAngle } from './board/boardStore'
import { boardByLayoutId } from './board/boards'
import { loadSeed } from './catalog/filterSeed'
import type { CatalogProblem } from './catalog/catalogSync'

// Keep the slab deterministic and network-free so route behavior is what's tested.
function problem(id: string, name: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name,
    grade: '6B',
    user_grade: null,
    setter: 'Alice',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
  }
}
const SLAB = [problem('a', 'Alpha'), problem('b', 'Bravo'), problem('c', 'Charlie')]

vi.mock('./catalog/useSlab', () => ({
  useSlab: () => ({ problems: SLAB, loading: false, degraded: false }),
}))

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage')) // reset the boardStore snapshot
})

describe('bare-/ redirect', () => {
  it('lands on My Boards when no boards are added', async () => {
    renderWithRouter('/')
    expect(await screen.findByText('Add your first board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('redirects to the active board catalog once a board is added', async () => {
    addBoard(7)
    renderWithRouter('/')
    // The catalog list renders the mocked slab.
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search problems' })).toBeInTheDocument()
  })
})

describe('catalog route guards', () => {
  it('bounces an unknown board id to My Boards', async () => {
    addBoard(7)
    renderWithRouter('/board/999/catalog')
    expect(await screen.findByText(/my boards/i)).toBeInTheDocument()
  })

  it('previews a registry-valid but un-added board (does not bounce)', async () => {
    addBoard(7) // board 5 is valid but NOT added
    renderWithRouter('/board/5/catalog')
    expect(await screen.findByText('Add this board')).toBeInTheDocument()
    // Still browsable — the slab renders behind the preview banner.
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('adds the previewed board from the banner CTA and clears the banner', async () => {
    addBoard(7)
    renderWithRouter('/board/5/catalog')
    fireEvent.click(await screen.findByRole('button', { name: 'Add this board' }))
    await waitFor(() => expect(getAddedBoardIds()).toContain(5))
    expect(screen.queryByText('Add this board')).toBeNull()
  })
})

describe('URL is the source of truth', () => {
  it('seeds the search field from ?q on a deep link', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog?q=crimp')
    const field = await screen.findByRole('textbox', { name: 'Search problems' })
    expect(field).toHaveValue('crimp')
  })

  it('opens a deep-linked problem drawer', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog?problem=b')
    // ProblemDetail renders the problem's name as a heading (uppercased via CSS).
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
  })

  it('writes a filter change to the URL and through to the cold-launch seed', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open the filter sheet and toggle Benchmarks.
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Benchmarks' }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ bench: 1 }))
    // Written through to the seed so a cold launch reproduces it.
    expect(loadSeed(7, 40).benchmarkOnly).toBe(true)
  })

  it('mirrors a deep-linked ?angle back into boardStore', async () => {
    addBoard(5) // board 5 supports [40, 25]
    renderWithRouter('/board/5/catalog?angle=25')
    await screen.findByText('Alpha')
    await waitFor(() => expect(getAngle(boardByLayoutId(5)!)).toBe(25))
  })
})

describe('search field <-> URL sync', () => {
  it('does not strand a half-typed query when switching boards mid-debounce', async () => {
    addBoard(7)
    renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Type without waiting for the 250ms debounce to write ?q.
    const field = screen.getByRole('textbox', { name: 'Search problems' })
    fireEvent.change(field, { target: { value: 'carafes' } })
    expect(field).toHaveValue('carafes')

    // Leave the catalog before the debounce fires, then come back. AppLayout is the
    // persistent root, so its field state survives — it must resync to the URL (empty
    // ?q) rather than showing a query the list isn't actually filtered by.
    fireEvent.click(screen.getByRole('button', { name: 'Boards' }))
    await screen.findByRole('button', { name: 'Search' })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    const back = await screen.findByRole('textbox', { name: 'Search problems' })
    expect(back).toHaveValue('')
  })
})

describe('drawer history semantics', () => {
  it('Back closes a push-opened drawer without exiting the catalog', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open a problem (push).
    fireEvent.click(screen.getByText('Bravo'))
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
    expect(router.state.location.search).toMatchObject({ problem: 'b' })

    // Back closes the drawer (removes ?problem) and stays on the catalog.
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })

  it('pages with replace so a single Back returns to the catalog, not prior problems', async () => {
    addBoard(7)
    const { router } = renderWithRouter('/board/7/catalog')
    await screen.findByText('Alpha')

    // Open the first problem (push), then page forward twice (each a replace).
    fireEvent.click(screen.getByText('Alpha'))
    await screen.findByRole('heading', { name: 'Alpha' })
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(await screen.findByRole('heading', { name: 'Bravo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(await screen.findByRole('heading', { name: 'Charlie' })).toBeInTheDocument()

    // One Back skips the replaced pages and lands on the clean catalog entry.
    router.history.back()
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('problem'))
    expect(router.state.location.pathname).toBe('/board/7/catalog')
  })
})
