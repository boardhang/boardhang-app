import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterPillBar } from './FilterPillBar'
import type { SavedList } from '../lists/listsTypes'

const board = boardByLayoutId(7)!

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
      signedOut={over.signedOut ?? false}
      boardLists={over.boardLists ?? []}
      layoutId={over.layoutId ?? 7}
      gradeSpan={[3, 15]}
      board={board}
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

// The unified nav rule: pinned → always shown as its control; unpinned + active → removable
// chip; a facet never appears twice. Each test uses a distinct layoutId to avoid the store's
// per-layout snapshot cache carrying pins between cases.
describe('FilterPillBar — pinned controls vs. active chips', () => {
  it('shows a pinned rich facet as an always-visible control, even when inactive', () => {
    localStorage.setItem('catalogPinnedFilters_101', JSON.stringify(['grade']))
    renderBar({ layoutId: 101 })
    // Grade is not set, but pinned → its control renders, labelled with the facet name.
    expect(screen.getByRole('button', { name: 'Grade' })).toBeInTheDocument()
  })

  it('shows an unpinned active facet as a removable chip', () => {
    localStorage.setItem('catalogPinnedFilters_102', JSON.stringify([]))
    renderBar({ layoutId: 102, filters: state({ gradeRange: [4, 8] }) })
    expect(screen.getByRole('button', { name: /^Remove .* filter$/ })).toBeInTheDocument()
  })

  it('does not duplicate a pinned active facet as both a control and a chip', () => {
    localStorage.setItem('catalogPinnedFilters_103', JSON.stringify(['grade']))
    renderBar({ layoutId: 103, filters: state({ gradeRange: [4, 8] }) })
    // Rendered once, as the pinned control — never also as a removable chip.
    expect(screen.queryByRole('button', { name: /^Remove .* filter$/ })).toBeNull()
  })

  it('suppresses a pinned Status control when signed out (status cannot filter)', () => {
    localStorage.setItem('catalogPinnedFilters_105', JSON.stringify(['status']))
    renderBar({ layoutId: 105, signedOut: true })
    expect(screen.queryByRole('button', { name: 'Ascent status' })).toBeNull()
  })

  it('shows an unpinned active toggle facet (Favorites) as a removable chip, not vanished', () => {
    // Regression: unpinning Benchmarks/Favorites/Lists must not make an active filter
    // invisible in the header (no control AND no chip).
    localStorage.setItem('catalogPinnedFilters_104', JSON.stringify([]))
    renderBar({ layoutId: 104, filters: state({ favoritesOnly: true }) })
    expect(screen.getByRole('button', { name: 'Remove Favorites filter' })).toBeInTheDocument()
  })
})
