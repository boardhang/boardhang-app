import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { CatalogList } from './CatalogList'
import type { CatalogProblem } from './catalogSync'
import type { SenderChip } from './useMemberSenders'

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
  searchActive?: boolean
  sentIds?: Set<string>
  senders?: Map<string, SenderChip[]>
  sendersDimmed?: boolean
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
      searchActive={opts.searchActive}
      sentIds={opts.sentIds}
      senders={opts.senders}
      sendersDimmed={opts.sendersDimmed}
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

  it('points the empty state at the search ✕ (not filters) when a query narrows to nothing', () => {
    renderList([problem('a', '6A', 'ALPHA')], { transform: () => [], searchActive: true })
    const empty = screen.getByTestId('catalog-empty')
    expect(empty).toHaveTextContent(/match your search/i)
    expect(empty).toHaveTextContent(/clear the search/i)
    expect(empty).not.toHaveTextContent(/clear filters/i)
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

  it('shows row thumbnails by default and hides them via the previews toggle', () => {
    const { container } = renderList([problem('a', '6A', 'Alpha')])
    expect(container.querySelector('.catalog-board')).not.toBeNull()
    const toggle = screen.getByRole('button', { name: /hide climb previews/i })
    act(() => {
      fireEvent.click(toggle)
    })
    expect(container.querySelector('.catalog-board')).toBeNull()
    expect(screen.getByRole('button', { name: /show climb previews/i })).toBeInTheDocument()
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

  it('forwards each problem its own sender chips (and none to unmatched rows)', () => {
    const senders = new Map<string, SenderChip[]>([
      ['a', [{ userId: 'x', isSelf: false, label: 'Alice', initials: 'AL', avatarUrl: null }]],
    ])
    const { container } = renderList([problem('a', '6A', 'Alpha'), problem('b', '6A', 'Beta')], { senders })
    // Only the matched row gets a sends pill.
    const groups = container.querySelectorAll('[data-slot="avatar-group"]')
    expect(groups).toHaveLength(1)
    expect(groups[0].parentElement!.getAttribute('aria-label')).toBe('Sent by Alice')
  })

  it('propagates sendersDimmed to the rows', () => {
    const senders = new Map<string, SenderChip[]>([
      ['a', [{ userId: 'x', isSelf: false, label: 'Alice', initials: 'AL', avatarUrl: null }]],
    ])
    const { container } = renderList([problem('a', '6A', 'Alpha')], { senders, sendersDimmed: true })
    // The pill (the avatar group's parent) carries the dim treatment.
    expect(container.querySelector('[data-slot="avatar-group"]')!.parentElement!.className).toContain('opacity-50')
  })

  it('suppresses the name-line self-check when a session is active (senders map present)', () => {
    // sentIds marks the row as self-sent, but a session is active (empty senders map supplied),
    // and this problem has no pill entry → no "Sent" mark shows on the name line.
    const { container } = renderList([problem('a', '6A', 'Alpha')], {
      sentIds: new Set(['a']),
      senders: new Map(),
    })
    expect(container.querySelector('[aria-label="Sent"]')).toBeNull()
  })
})
