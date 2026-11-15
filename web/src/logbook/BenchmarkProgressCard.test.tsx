import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import { BenchmarkProgressCard } from './BenchmarkProgressCard'

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

// 6C ×2, 6C+ ×1, 7A ×1, 7B ×1 benchmarks, plus one 7B that is not a benchmark.
const SLAB = [
  problem('a', '6C'),
  problem('b', '6C'),
  problem('g', '6C+'),
  problem('c', '7A'),
  problem('d', '7B'),
  problem('x', '7B', false),
]
// Sends at 6C and 7A: the hardest send is 7A, 6C+ is a gap below it, 7B is above it.
const SENT = new Set(['a', 'c'])

const rowTexts = () => screen.getAllByRole('listitem').map((li) => li.textContent)

afterEach(() => {
  localStorage.clear()
  navigate.mockClear()
  slab = []
})

describe('BenchmarkProgressCard', () => {
  it('counts the grades up to the hardest send and starts collapsed', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    // 7B (above the hardest send) is left out of the total: 2 of 4, not 2 of 5.
    expect(await screen.findByText('2 of 4 sent · up to 7A')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '50% of benchmarks sent' })).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('expands to a row per grade, hardest first, keeping gaps below the hardest send', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    expect(rowTexts()).toEqual(['7A1/1', '6C+0/1', '6C1/2'])
  })

  it('shows every grade, and counts them, on "Show all grades"', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show all grades' }))

    expect(rowTexts()).toEqual(['7B0/1', '7A1/1', '6C+0/1', '6C1/2'])
    expect(screen.getByText('2 of 5 sent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Only up to my hardest send' })).toBeInTheDocument()
  })

  it('remembers both toggles', async () => {
    slab = SLAB
    const first = render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show all grades' }))
    first.unmount()

    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    expect(await screen.findByRole('button', { name: 'Hide grades' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('shows every grade, with no toggle, when nothing has been sent', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)

    expect(await screen.findByText('0 of 5 sent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Show all grades' })).not.toBeInTheDocument()
  })

  it('renders nothing when the slab is not cached', async () => {
    const { container } = render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)
    // Let the (empty) cache read settle.
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the catalog on the unsent benchmarks of a tapped grade', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    fireEvent.click(screen.getByRole('button', { name: /^6C: 1 of 2 sent/ }))

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
