import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { FONT_GRADES } from '../board/grades'
import type { CatalogProblem } from '../catalog/catalogSync'
import { BenchmarkProgressCard } from './BenchmarkProgressCard'
import { loadMode, loadRange, saveMode, saveRange } from './benchmarkProgress'

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
const sliders = () => document.querySelectorAll('input[type="range"]')

async function renderExpanded(sentIds: Set<string> = SENT) {
  slab = SLAB
  render(<BenchmarkProgressCard board={board} sentIds={sentIds} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Show grades' }))
}

afterEach(() => {
  localStorage.clear()
  navigate.mockClear()
  slab = []
})

describe('BenchmarkProgressCard', () => {
  it('counts the whole board and starts collapsed', async () => {
    slab = SLAB
    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)

    // Every benchmark counts, including 7B above the hardest send: 2 of 5.
    expect(await screen.findByText('2 of 5 sent')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '40% of benchmarks sent' })).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('expands to bars up to the hardest send, hardest first, keeping gaps below it', async () => {
    await renderExpanded()

    // 7B is counted in the headline but gets no bar; 6C+ (a gap below 7A) does.
    expect(rowTexts()).toEqual(['7A1/1', '6C+0/1', '6C1/2'])
    expect(screen.getByText('2 of 5 sent')).toBeInTheDocument()
    // "All grades" is the selected mode, and it shows no slider.
    expect(screen.getByRole('button', { name: 'All grades' })).toHaveAttribute('aria-pressed', 'true')
    expect(sliders()).toHaveLength(0)
  })

  it('"Custom" shows the grade slider, starting from the up-to-hardest range', async () => {
    await renderExpanded()

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))

    // One range input per thumb, and the range as badges beside the "Grade" label.
    expect(sliders()).toHaveLength(2)
    expect(screen.getByText('Grade').parentElement).toHaveTextContent('Grade6Cto7A')
    // Custom counts only its range: 7B drops out of the total.
    expect(screen.getByText('2 of 4 sent · 6C to 7A')).toBeInTheDocument()
    expect(loadMode()).toBe('custom')
  })

  it('narrows to the dragged custom range and remembers it for the board', async () => {
    await renderExpanded()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))

    // Raise the low thumb from 6C to 7A: only 7A is left.
    fireEvent.change(screen.getByLabelText('Lowest grade'), { target: { value: String(ord('7A')) } })

    expect(screen.getByText('1 of 1 sent · 7A')).toBeInTheDocument()
    expect(rowTexts()).toEqual(['7A1/1'])
    expect(loadRange(board.layoutId)).toEqual([ord('7A'), ord('7A')])
  })

  it('keeps the custom range when switching away and back', async () => {
    saveRange(board.layoutId, [ord('7A'), ord('7B')])
    await renderExpanded()

    // The stored custom range is not applied until Custom is chosen.
    expect(screen.getByText('2 of 5 sent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.getByText('1 of 2 sent · 7A to 7B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All grades' }))
    expect(screen.getByText('2 of 5 sent')).toBeInTheDocument()
    expect(loadMode()).toBe('all')
    expect(loadRange(board.layoutId)).toEqual([ord('7A'), ord('7B')])
  })

  it('reopens in the remembered mode and expanded state', async () => {
    saveMode('custom')
    saveRange(board.layoutId, [ord('7A'), ord('7B')])
    slab = SLAB
    const first = render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    // The custom range applies while the card is still collapsed.
    expect(await screen.findByText('1 of 2 sent · 7A to 7B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show grades' }))
    first.unmount()

    render(<BenchmarkProgressCard board={board} sentIds={SENT} />)
    expect(await screen.findByRole('button', { name: 'Hide grades' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowTexts()).toEqual(['7B0/1', '7A1/1'])
  })

  it('covers every grade when nothing has been sent', async () => {
    await renderExpanded(new Set())

    expect(screen.getByText('0 of 5 sent')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('renders nothing when the slab is not cached', async () => {
    const { container } = render(<BenchmarkProgressCard board={board} sentIds={new Set()} />)
    // Let the (empty) cache read settle.
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a board and angle with no benchmarks', async () => {
    // e.g. MoonBoard 2016 at 25°: problems, but none of them benchmarks.
    slab = [problem('x', '6C', false), problem('y', '7A', false)]
    const { container } = render(<BenchmarkProgressCard board={board} sentIds={new Set(['x'])} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the catalog on the unsent benchmarks of a tapped grade', async () => {
    await renderExpanded()

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
