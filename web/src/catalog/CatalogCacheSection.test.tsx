import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogCacheSection } from './CatalogCacheSection'
import type { SyncResult } from './catalogSync'

// The sync layer is exercised in catalogSync.test.ts (against fake-indexeddb); here we only
// care that the section reports counts and drives a rebuild per owned board+angle.
const h = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  rebuilt: [] as string[],
  rebuildResult: (_key: string) => ({ problems: [], synced: true }) as SyncResult,
}))

vi.mock('./catalogSync', () => ({
  countSlab: (layoutId: number, angle: number) =>
    Promise.resolve(h.counts[`${layoutId}_${angle}`] ?? 0),
  rebuildSlab: (layoutId: number, angle: number) => {
    const key = `${layoutId}_${angle}`
    h.rebuilt.push(key)
    return Promise.resolve(h.rebuildResult(key))
  },
}))

vi.mock('sonner', () => ({ toast: vi.fn() }))

/** Own Mini 2025 (one slab) + Masters 2019 (two slabs), via boardStore's localStorage. */
function ownBoards(ids: string) {
  localStorage.setItem('addedBoards', ids)
  window.dispatchEvent(new StorageEvent('storage'))
}

const problems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ source_catalog_id: String(i) })) as SyncResult['problems']

beforeEach(() => {
  localStorage.clear()
  h.counts = {}
  h.rebuilt = []
  h.rebuildResult = () => ({ problems: [], synced: true })
})

describe('CatalogCacheSection', () => {
  it('renders nothing until the user owns a board', () => {
    ownBoards('')
    const { container } = render(<CatalogCacheSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the cached problem count for every owned board and angle', async () => {
    h.counts = { '7_40': 1500, '5_40': 150, '5_25': 12000 }
    ownBoards('7|5')
    render(<CatalogCacheSection />)
    // The short 2019 slab the rebuild exists for is visible as a number, not a guess.
    expect(await screen.findByText(/40° · 1,500 problems/)).toBeInTheDocument()
    expect(await screen.findByText(/40° · 150 problems/)).toBeInTheDocument()
    expect(await screen.findByText(/25° · 12,000 problems/)).toBeInTheDocument()
    expect(screen.getAllByText('MoonBoard Masters 2019')).toHaveLength(2)
  })

  it('rebuilds only the board+angle whose button was pressed', async () => {
    h.counts = { '5_40': 150, '5_25': 12000 }
    h.rebuildResult = () => ({ problems: problems(3), synced: true })
    ownBoards('5')
    render(<CatalogCacheSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild MoonBoard Masters 2019 40°' }))
    fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }))

    await waitFor(() => expect(h.rebuilt).toEqual(['5_40']))
    // The untouched 25° slab keeps its count — no collateral re-download.
    expect(await screen.findByText(/40° · 3 problems/)).toBeInTheDocument()
    expect(screen.getByText(/25° · 12,000 problems/)).toBeInTheDocument()
  })

  it('names the board in the confirmation so the wrong one cannot be wiped by accident', async () => {
    ownBoards('5')
    render(<CatalogCacheSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild MoonBoard Masters 2019 25°' }))
    expect(
      await screen.findByRole('heading', { name: 'Rebuild MoonBoard Masters 2019 25°?' }),
    ).toBeInTheDocument()
  })

  it('does not touch the cache when the confirmation is cancelled', async () => {
    ownBoards('7')
    render(<CatalogCacheSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild Mini MoonBoard 2025 40°' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(h.rebuilt).toEqual([])
  })

  it('surfaces why a slab failed instead of silently leaving it short', async () => {
    h.rebuildResult = () => ({ problems: [], synced: false, error: 'QuotaExceededError' })
    ownBoards('7')
    render(<CatalogCacheSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild Mini MoonBoard 2025 40°' }))
    fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('QuotaExceededError')
  })
})
