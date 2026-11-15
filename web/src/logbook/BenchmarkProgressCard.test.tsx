import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import { BenchmarkProgressCard } from './BenchmarkProgressCard'
import { loadRange, saveRange } from './benchmarkProgress'

const navigate = vi.fn()
let slab: CatalogProblem[] = []

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('../catalog/catalogSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog/catalogSync')>()
  return { ...actual, readSlab: vi.fn(async () => slab) }
})
// The real slider (Base UI) keeps updating itself after mount, outside act(). A plain pair of
// range inputs is enough here: the card only needs value in, onValueChange out.
vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    value,
    min,
    max,
    onValueChange,
  }: {
    value: number[]
    min: number
    max: number
    onValueChange: (value: number[]) => void
  }) => (
    <div>
      {value.map((v, i) => (
        <input
          key={i}
          type="range"
          aria-label={i === 0 ? 'Lowest grade' : 'Highest grade'}
          min={min}
          max={max}
          value={v}
          onChange={(e) => onValueChange(value.map((x, j) => (j === i ? Number(e.target.value) : x)))}
        />
      ))}
    </div>
  ),
}))
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
    expect(await screen.findByText('2 of 4 sent · 6C to 7A')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '50% of benchmarks sent' })).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('expands to a row per grade, hardest first, keeping gaps below the hardest send', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    expect(rowTexts()).toEqual(['7A1/1', '6C+0/1', '6C1/2'])
  })

  it('offers a grade slider, with the range as badges, once expanded', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))

    // One range input per thumb: the lowest and the highest grade.
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(2)
    expect(screen.getByText('Grade').parentElement).toHaveTextContent('Grade6Cto7A')
  })

  it('narrows to the dragged range, remembers it, and lets go of it at the default', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))

    // Raise the low thumb from 6C to 7A: only 7A is left.
    fireEvent.change(screen.getByLabelText('Lowest grade'), { target: { value: String(ord('7A')) } })
    expect(screen.getByText('1 of 1 sent · 7A')).toBeInTheDocument()
    expect(rowTexts()).toEqual(['7A1/1'])
    expect(loadRange(board.layoutId)).toEqual([ord('7A'), ord('7A')])

    // Back to the default (6C up to the hardest send): nothing is stored, so the range
    // goes on following the hardest send.
    fireEvent.change(screen.getByLabelText('Lowest grade'), { target: { value: String(ord('6C')) } })
    expect(screen.getByText('2 of 4 sent · 6C to 7A')).toBeInTheDocument()
    expect(loadRange(board.layoutId)).toBeNull()
  })

  it('follows a picked range in the count, the ring and the rows', async () => {
    slab = SLAB
    saveRange(board.layoutId, [ord('7A'), ord('7B')])
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    expect(await screen.findByText('1 of 2 sent · 7A to 7B')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '50% of benchmarks sent' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    expect(rowTexts()).toEqual(['7B0/1', '7A1/1'])
  })

  it('drops the range note when the range is the whole board', async () => {
    slab = SLAB
    saveRange(board.layoutId, [ord('6C'), ord('7B')])
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    expect(await screen.findByText('2 of 5 sent')).toBeInTheDocument()
  })

  it('remembers that the grades were left open', async () => {
    slab = SLAB
    const first = render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
    first.unmount()

    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    expect(await screen.findByRole('button', { name: 'Hide grades' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('covers every grade when nothing has been sent', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)

    expect(await screen.findByText('0 of 5 sent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
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
