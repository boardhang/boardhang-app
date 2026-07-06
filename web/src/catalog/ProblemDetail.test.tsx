import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { isFavorite } from './favoritesStore'
import { getRecentIds } from './recentsStore'
import { ProblemDetail } from './ProblemDetail'
import { AuthProvider } from '../auth/AuthProvider'
import * as ble from '../ble/useBle'

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

const board = boardByLayoutId(7)!

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

const list = [problem('a', 'First'), problem('b', 'Middle'), problem('c', 'Last')]

// A controlled harness mirroring CatalogScreen: the URL (here, local state) owns the
// shown problem; ProblemDetail pages by calling onNavigate. `displayed` is the paging
// domain; the shown problem is resolved against it, falling back to `slab` (so a
// deep-linked, filtered-out problem still renders standalone).
function Pager({ id, displayed, slab = list }: { id: string; displayed: CatalogProblem[]; slab?: CatalogProblem[] }) {
  const [current, setCurrent] = useState(id)
  const resolved =
    displayed.find((p) => p.source_catalog_id === current) ??
    slab.find((p) => p.source_catalog_id === current)!
  return (
    <AuthProvider>
      <ProblemDetail
        problem={resolved}
        displayed={displayed}
        board={board}
        angle={40}
        favoriteIds={new Set()}
        sentIds={new Set()}
        onNavigate={setCurrent}
      />
    </AuthProvider>
  )
}

function renderDetail(id: string, displayed = list) {
  return render(<Pager id={id} displayed={displayed} />)
}

beforeEach(() => {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
  vi.clearAllMocks()
  vi.mocked(ble.useBle).mockReturnValue({ state: 'disconnected', deviceName: null, error: null })
  vi.mocked(ble.isConnected).mockReturnValue(false)
})

describe('ProblemDetail', () => {
  it('renders the current problem metadata', () => {
    renderDetail('b')
    expect(screen.getByText('Middle')).toBeInTheDocument()
    expect(screen.getByText('by Alice')).toBeInTheDocument()
    expect(screen.getByText('6B')).toBeInTheDocument()
  })

  it('disables prev at the first and next at the last (no wrap)', () => {
    renderDetail('a')
    expect(screen.getByRole('button', { name: 'Previous problem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next problem' })).toBeEnabled()
  })

  it('pages forward through the list', () => {
    renderDetail('b')
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }))
    expect(screen.getByText('Last')).toBeInTheDocument()
  })

  it('shows a deep-linked problem excluded from the filtered list with paging disabled', () => {
    // "Middle" is not in the displayed (filtered) list, but resolves from the slab.
    render(<Pager id="b" displayed={[list[0], list[2]]} />)
    expect(screen.getByText('Middle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous problem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next problem' })).toBeDisabled()
  })

  it('records the viewed problem into recents', () => {
    renderDetail('b')
    expect(getRecentIds(7, 40)).toEqual(['b'])
  })

  it('toggles the favorite', () => {
    renderDetail('b')
    expect(isFavorite('b')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(isFavorite('b')).toBe(true)
  })

  it('connects before sending when disconnected, and does not send if connect fails', async () => {
    vi.mocked(ble.isConnected).mockReturnValue(false) // stays disconnected
    renderDetail('b')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /connect & light up/i }))
    })
    expect(ble.connectBoard).toHaveBeenCalled()
    expect(ble.bleClient.send).not.toHaveBeenCalled()
  })

  it('sends the mapped holds when already connected', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    renderDetail('b')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /light up/i }))
    })
    expect(ble.bleClient.send).toHaveBeenCalledWith(
      [{ col: 0, row: 1, type: 'start' }],
      expect.objectContaining({ rows: 12, showBeta: true }),
    )
  })

  it('surfaces a send error', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    vi.mocked(ble.bleClient.send).mockRejectedValueOnce(new Error('write failed'))
    renderDetail('b')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /light up/i }))
    })
    expect(screen.getByText('write failed')).toBeInTheDocument()
  })
})
