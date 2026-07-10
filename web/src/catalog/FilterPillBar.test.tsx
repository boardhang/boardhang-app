import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterPillBar } from './FilterPillBar'
import type { SavedList } from '../lists/listsTypes'

function savedList(id: string, name: string): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId: 7,
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

const state = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...over })

function renderBar(over: Partial<Parameters<typeof FilterPillBar>[0]> = {}) {
  return render(
    <FilterPillBar
      filters={over.filters ?? state()}
      onChange={over.onChange ?? (() => {})}
      inSession={false}
      statusReady={false}
      boardLists={over.boardLists ?? []}
    />,
  )
}

describe('FilterPillBar — Lists control (R4)', () => {
  it('hides the "Lists" opener when the board has no lists', () => {
    renderBar({ boardLists: [] })
    expect(screen.queryByRole('button', { name: 'Filter by list' })).toBeNull()
  })

  it('shows the "Lists" opener when the board has ≥1 list', () => {
    renderBar({ boardLists: [savedList('a', 'Projects')] })
    expect(screen.getByRole('button', { name: 'Filter by list' })).toBeInTheDocument()
  })

  it('emits no removable list chips (the selection is edited via the sheet)', () => {
    renderBar({
      filters: state({ listFilter: ['a', 'b'] }),
      boardLists: [savedList('a', 'Projects'), savedList('b', 'Warm-ups')],
    })
    expect(screen.queryByRole('button', { name: 'Remove Projects filter' })).toBeNull()
  })
})
