import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { CatalogList } from './CatalogList'
import type { CatalogProblem } from './catalogSync'
import { recordRecent } from './recentsStore'

const board = boardByLayoutId(7)!

function problem(id: string, grade: string, name: string): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 7,
    angle: 40,
    name,
    grade,
    user_grade: null,
    setter: 'setter',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
  }
}

interface Opts {
  loading?: boolean
  degraded?: boolean
  transform?: (p: CatalogProblem[]) => CatalogProblem[]
}

function renderList(problems: CatalogProblem[], opts: Opts = {}) {
  return render(
    <CatalogList
      board={board}
      angle={40}
      problems={problems}
      loading={opts.loading ?? false}
      degraded={opts.degraded ?? false}
      transform={opts.transform}
    />,
  )
}

beforeEach(() => {
  localStorage.clear()
  // Reset the reactive recentsStore cache (survives localStorage.clear()).
  window.dispatchEvent(new StorageEvent('storage'))
})

describe('CatalogList', () => {
  it('shows a loading skeleton before the first slab resolves', () => {
    renderList([], { loading: true })
    expect(screen.getByTestId('catalog-loading')).toBeInTheDocument()
  })

  it('shows the unseeded empty state when there are no problems', () => {
    renderList([])
    expect(screen.getByTestId('catalog-empty')).toHaveTextContent(/sync this board/i)
  })

  it('shows an offline empty state when degraded with no cache', () => {
    renderList([], { degraded: true })
    expect(screen.getByTestId('catalog-empty')).toHaveTextContent(/offline/i)
  })

  it('renders rows sorted easiest-first by grade with a count', () => {
    renderList([problem('a', '7A', 'Hard'), problem('b', '6A', 'Easy')])
    expect(screen.getByText('2 problems')).toBeInTheDocument()
    const names = screen.getAllByText(/Hard|Easy/).map((n) => n.textContent)
    expect(names).toEqual(['Easy', 'Hard']) // 6A before 7A
  })

  it('shows an offline banner alongside cached rows', () => {
    renderList([problem('a', '6A', 'Cached')], { degraded: true })
    expect(screen.getByTestId('catalog-offline')).toBeInTheDocument()
    expect(screen.getByText('Cached')).toBeInTheDocument()
  })

  it('paginates at 30 with a Show more control', () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      problem(`p${i}`, '6A', `Problem ${String(i).padStart(2, '0')}`),
    )
    renderList(many)
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show more/i }))
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull()
  })

  it('surfaces recently-viewed problems for the slab', () => {
    recordRecent(7, 40, 'a')
    renderList([problem('a', '6A', 'Seen'), problem('b', '6B', 'Other')])
    expect(screen.getByText('Recently viewed')).toBeInTheDocument()
  })

  it('reacts to a view recorded after mount (reactive recents)', () => {
    renderList([problem('a', '6A', 'Seen')])
    expect(screen.queryByText('Recently viewed')).toBeNull()
    act(() => recordRecent(7, 40, 'a'))
    expect(screen.getByText('Recently viewed')).toBeInTheDocument()
  })

  it('applies a transform (filtered subset) and shows the filters-empty state', () => {
    const problems = [problem('a', '6A', 'Keep'), problem('b', '7A', 'Drop')]
    const keepOnly = (ps: CatalogProblem[]) => ps.filter((p) => p.name === 'Keep')
    const { rerender } = renderList(problems, { transform: keepOnly })
    expect(screen.getByText('Keep')).toBeInTheDocument()
    expect(screen.queryByText('Drop')).toBeNull()
    expect(screen.getByText('1 problems')).toBeInTheDocument()

    rerender(
      <CatalogList board={board} angle={40} problems={problems} loading={false} degraded={false} transform={() => []} />,
    )
    expect(screen.getByTestId('catalog-empty')).toHaveTextContent(/no problems match/i)
  })
})
