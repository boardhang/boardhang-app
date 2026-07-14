import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { LastOpenedBar } from './LastOpenedBar'
import { dismissLastOpened, recordOpened } from './lastOpenedStore'
import { isFavorite } from './favoritesStore'
import { setShowPreviews } from './previewsStore'

// Isolate the bar from board-art rendering and BLE. The previews store is real so
// tests can exercise the lastOpened thumbnail toggle.
vi.mock('../board/CatalogBoard', () => ({
  CatalogBoard: () => <div data-testid="thumb" />,
}))

const lightUp = vi.fn()
vi.mock('../ble/useLightUp', () => ({
  useLightUp: () => ({
    lightUp: (holds: unknown) => lightUp(holds),
    lit: false,
    busy: null,
    error: null,
    state: 'disconnected',
  }),
}))

const board = boardByLayoutId(7)!
const ANGLE = 40

function problem(id: string, name: string, over: Partial<CatalogProblem> = {}): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: ANGLE,
    name,
    grade: '6B',
    user_grade: null,
    setter: 'Alice',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
    ...over,
  }
}

const a = problem('a', 'Alpha')
const b = problem('b', 'Bravo')
const c = problem('c', 'Charlie', { is_benchmark: true })
const list = [a, b, c]

const onOpen = vi.fn()
const onDismiss = vi.fn()

function mount(problems = list, sentIds = new Set<string>()) {
  return render(
    <LastOpenedBar
      board={board}
      angle={ANGLE}
      problems={problems}
      sentIds={sentIds}
      onOpen={onOpen}
      onDismiss={onDismiss}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // Reset the previews snapshot (survives localStorage.clear()).
  window.dispatchEvent(new StorageEvent('storage'))
  dismissLastOpened(7, ANGLE)
})

describe('LastOpenedBar', () => {
  it('renders nothing on a cold load (no last-opened)', () => {
    const { container } = mount()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the last-opened problem (name, grade, setter)', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByText('6B')).toBeInTheDocument()
    expect(screen.getByText('by Alice')).toBeInTheDocument()
  })

  it('shows the full metadata row (stars, repeats, method, setter) like the catalog rows', () => {
    const d = problem('d', 'Delta', { stars: 5, repeats: 463, method: 'No kickboard' })
    recordOpened(7, ANGLE, 'd')
    mount([d])
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('463')).toBeInTheDocument()
    expect(screen.getByText('No kickboard')).toBeInTheDocument()
    expect(screen.getByText('by Alice')).toBeInTheDocument()
  })

  it('body tap opens the drawer on the shown problem', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open Bravo' }))
    expect(onOpen).toHaveBeenCalledWith('b')
  })

  it('keeps showing a last-opened climb the filters now exclude', () => {
    recordOpened(7, ANGLE, 'a')
    // `a` isn't in the filtered set [b, c] but is still resolved from the full slab.
    mount()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('updates to a newly-opened problem', () => {
    recordOpened(7, ANGLE, 'a')
    mount()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    act(() => recordOpened(7, ANGLE, 'c'))
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('shows the benchmark icon for a benchmark problem', () => {
    recordOpened(7, ANGLE, 'c') // c is a benchmark
    mount()
    expect(screen.getByRole('img', { name: 'Benchmark' })).toBeInTheDocument()
  })

  it('shows the sent icon when the shown problem is marked sent', () => {
    recordOpened(7, ANGLE, 'b')
    mount(list, new Set(['b']))
    expect(screen.getByRole('img', { name: 'Sent' })).toBeInTheDocument()
  })

  it('omits the sent icon when the shown problem is not sent', () => {
    recordOpened(7, ANGLE, 'b')
    mount(list, new Set(['a']))
    expect(screen.queryByRole('img', { name: 'Sent' })).toBeNull()
  })

  it('♡ toggles favorite for the shown problem', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    expect(isFavorite('b')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    expect(isFavorite('b')).toBe(true)
  })

  it('💡 lights up the shown problem’s holds', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Light up' }))
    expect(lightUp).toHaveBeenCalledWith(b.holds)
  })

  it('hides only the thumbnail when the lastOpened previews toggle is off', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    expect(screen.getByTestId('thumb')).toBeInTheDocument()
    act(() => setShowPreviews('lastOpened', false))
    expect(screen.queryByTestId('thumb')).toBeNull()
    // The bar itself (identity + actions) stays.
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('× calls onDismiss', () => {
    recordOpened(7, ANGLE, 'b')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
