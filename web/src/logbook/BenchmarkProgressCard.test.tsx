import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import { BenchmarkProgressCard } from './BenchmarkProgressCard'
import { saveRange } from './benchmarkProgress'

const navigate = vi.fn()
let slab: CatalogProblem[] = []

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('../catalog/catalogSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog/catalogSync')>()
  return { ...actual, readSlab: vi.fn(async () => slab) }
})
// Every hold counts as installed, so the hold-set filter never hides a test problem.
vi.mock('../board/holdSetMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../board/holdSetMembership')>()
  return { ...actual, isClimbable: () => true }
})

const board = boardByLayoutId(7)!
const ord = (grade: string) => FONT_GRADES.indexOf(grade)

function problem(id: string, grade: string, isBenchmark = true): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: board.layoutId,
    angle: 40,
    name: id,
    grade,
    user_grade: null,
    setter: 'Setter',
    stars: 0,
    repeats: 0,
    is_benchmark: isBenchmark,
    method: null,
    holds: [],
  }
}

const SLAB = [
  problem('a', '6C'),
  problem('b', '6C'),
  problem('c', '7A'),
  problem('d', '7B'),
  problem('x', '7B', false),
]

afterEach(() => {
  localStorage.clear()
  navigate.mockClear()
  slab = []
})

describe('BenchmarkProgressCard', () => {
  it('shows the overall share and a row per grade, hardest first', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={new Set(['a', 'c'])} />)

    expect(await screen.findByText('2 of 4 sent')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '50% of benchmarks sent' })).toBeInTheDocument()
    // The per-grade bars are collapsed until asked for.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['7B0/1', '7A1/1', '6C1/2'])
  })

  it('renders nothing when the slab is not cached', async () => {
    const { container } = render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)
    // Let the (empty) cache read settle.
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the grade slider hidden until the filter button is pressed', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)

    const button = await screen.findByRole('button', { name: 'Filter grades' })
    const sliderId = button.getAttribute('aria-controls')!
    expect(document.getElementById(sliderId)).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    // One range input per thumb: the lowest and the highest grade.
    expect(document.getElementById(sliderId)!.querySelectorAll('input[type="range"]')).toHaveLength(2)

    fireEvent.click(button)
    expect(document.getElementById(sliderId)).toBeNull()
  })

  it('remembers that the grades were left open', async () => {
    slab = SLAB
    const first = render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    first.unmount()

    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)
    expect(await screen.findByRole('button', { name: 'Hide grades' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows the range as grade badges beside the slider, like the catalog filter', async () => {
    slab = SLAB
    saveRange(board.layoutId, [ord('7A'), ord('7B')])
    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)

    const button = await screen.findByRole('button', { name: 'Filter grades' })
    fireEvent.click(button)
    // Let the slider thumbs finish mounting.
    await act(async () => {})
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(panel).toHaveTextContent('Grade7Ato7B')
  })

  it('applies the remembered range to the count, the rows and the button', async () => {
    slab = SLAB
    saveRange(board.layoutId, [ord('7A'), ord('7B')])
    render(<BenchmarkProgressCard board={board} sentIds={new Set(['a', 'c'])} />)

    expect(await screen.findByText('1 of 2 sent · 7A to 7B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('grade-filter-active')).toBeInTheDocument()
  })

  it('opens the catalog on the unsent benchmarks of a tapped grade', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    fireEvent.click(screen.getByRole('button', { name: /^6C: 0 of 2 sent/ }))

    expect(navigate).toHaveBeenCalledTimes(1)
    const target = navigate.mock.calls[0][0]
    expect(target.to).toBe('/board/$layoutId/catalog')
    expect(target.params).toEqual({ layoutId: String(board.layoutId) })
    expect(target.search).toMatchObject({
      bench: 1,
      grade: `${ord('6C')}-${ord('6C')}`,
      status: 'attempted,unlogged',
    })
  })
})
