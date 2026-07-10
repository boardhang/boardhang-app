import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
      listsById={over.listsById ?? new Map()}
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

  it('renders a removable chip per selected list, labelled from listsById', () => {
    renderBar({
      filters: state({ listFilter: ['a', 'b'] }),
      boardLists: [savedList('a', 'Projects'), savedList('b', 'Warm-ups')],
      listsById: new Map([
        ['a', { name: 'Projects' }],
        ['b', { name: 'Warm-ups' }],
      ]),
    })
    expect(screen.getByRole('button', { name: 'Remove Projects filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Warm-ups filter' })).toBeInTheDocument()
  })

  it('removing a list chip patches out just that id', () => {
    const onChange = vi.fn()
    renderBar({
      filters: state({ listFilter: ['a', 'b'] }),
      onChange,
      boardLists: [savedList('a', 'Projects'), savedList('b', 'Warm-ups')],
      listsById: new Map([
        ['a', { name: 'Projects' }],
        ['b', { name: 'Warm-ups' }],
      ]),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Projects filter' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ listFilter: ['b'] }))
  })
})
