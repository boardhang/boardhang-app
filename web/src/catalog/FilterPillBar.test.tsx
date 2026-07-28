import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterPillBar } from './FilterPillBar'
import type { SessionFilterUI } from './useSessionFilterRows'
import type { SavedList } from '../lists/listsTypes'

// The bar (and the Status control it renders) read session rows from the store hook; control
// them here so the session cases don't need a live sessions/projection store. Only the HOOK is
// replaced — activeStatusMemberCount / hasStatusSelections keep their real implementations, so
// the readiness gate these tests assert is the one that actually ships.
const h = vi.hoisted(() => ({ session: undefined as SessionFilterUI | undefined }))
vi.mock('./useSessionFilterRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useSessionFilterRows')>()),
  useSessionFilterRows: () => h.session,
}))

beforeEach(() => {
  h.session = undefined
})

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
      inSession={over.inSession ?? false}
      statusReady={over.statusReady ?? false}
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

// A pinned Status facet used to vanish from the header for the whole session, because the nav
// control could only edit single-user `statusFilters` (inert in a session). It now renders the
// per-member rows, so the pin means what it looks like it means.
function sessionUI(over: Partial<SessionFilterUI> = {}): SessionFilterUI {
  return {
    rows: over.rows ?? [
      { userId: 'me', label: 'You', initials: 'ME', avatarUrl: null, isSelf: true, selected: [], onToggle: vi.fn() },
      { userId: 'alice', label: 'Alice', initials: 'AL', avatarUrl: null, isSelf: false, selected: [], onToggle: vi.fn() },
    ],
    state: over.state ?? 'ready',
    onRefresh: over.onRefresh ?? vi.fn(),
    onClearAll: over.onClearAll ?? vi.fn(),
  }
}

/** A rows fixture where `selectedCount` members have a status selected (self first). */
function rowsWithSelections(selectedCount: number): SessionFilterUI['rows'] {
  return ['me', 'alice', 'bob'].map((userId, i) => ({
    userId,
    label: i === 0 ? 'You' : userId === 'alice' ? 'Alice' : 'Bob',
    initials: userId.slice(0, 2).toUpperCase(),
    avatarUrl: null,
    isSelf: i === 0,
    selected: i < selectedCount ? ['sent' as const] : [],
    onToggle: vi.fn(),
  }))
}

describe('FilterPillBar — pinned Status inside a session', () => {
  it('renders the pinned Status control in a session (not suppressed)', () => {
    localStorage.setItem('catalogPinnedFilters_110', JSON.stringify(['status']))
    h.session = sessionUI()
    renderBar({ layoutId: 110, inSession: true })
    expect(screen.getByRole('button', { name: 'Ascent status' })).toBeInTheDocument()
  })

  it('labels the control with the number of MEMBERS filtered, not statusFilters', () => {
    localStorage.setItem('catalogPinnedFilters_111', JSON.stringify(['status']))
    h.session = sessionUI({ rows: rowsWithSelections(2) })
    // statusFilters is deliberately non-empty: in a session it is inert and must not be counted.
    renderBar({ layoutId: 111, inSession: true, filters: state({ statusFilters: ['sent'] }) })
    expect(screen.getByRole('button', { name: 'Status (2)' })).toBeInTheDocument()
  })

  it('opens the per-member rows, not the single-user status chips', () => {
    localStorage.setItem('catalogPinnedFilters_112', JSON.stringify(['status']))
    const rows = rowsWithSelections(0)
    h.session = sessionUI({ rows })
    renderBar({ layoutId: 112, inSession: true })
    fireEvent.click(screen.getByRole('button', { name: 'Ascent status' }))
    const you = screen.getByRole('group', { name: 'Your ascent status' })
    expect(screen.getByRole('group', { name: 'Alice’s ascent status' })).toBeInTheDocument()
    fireEvent.click(within(you).getByRole('button', { name: 'Sent' }))
    expect(rows[0].onToggle).toHaveBeenCalledWith('sent', true)
  })

  it('clears every member via the store, not a FilterState patch', () => {
    localStorage.setItem('catalogPinnedFilters_113', JSON.stringify(['status']))
    const onClearAll = vi.fn()
    const onChange = vi.fn()
    h.session = sessionUI({ rows: rowsWithSelections(1), onClearAll })
    renderBar({ layoutId: 113, inSession: true, onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Status (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClearAll).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still suppresses the pinned Status control when signed out', () => {
    localStorage.setItem('catalogPinnedFilters_114', JSON.stringify(['status']))
    renderBar({ layoutId: 114, signedOut: true })
    expect(screen.queryByRole('button', { name: 'Ascent status' })).toBeNull()
  })
})

describe('FilterPillBar — UNpinned Status inside a session', () => {
  it('shows an active per-member filter as a removable chip, not nothing', () => {
    localStorage.setItem('catalogPinnedFilters_120', JSON.stringify([]))
    h.session = sessionUI({ rows: rowsWithSelections(2) })
    renderBar({ layoutId: 120, inSession: true })
    expect(screen.getByRole('button', { name: 'Remove Status (2) filter' })).toBeInTheDocument()
  })

  it('removing the chip clears every member via the store, not onChange', () => {
    localStorage.setItem('catalogPinnedFilters_121', JSON.stringify([]))
    const onClearAll = vi.fn()
    const onChange = vi.fn()
    h.session = sessionUI({ rows: rowsWithSelections(1), onClearAll })
    renderBar({ layoutId: 121, inSession: true, onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Status (1) filter' }))
    expect(onClearAll).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows no status chip when no member row is selected', () => {
    localStorage.setItem('catalogPinnedFilters_122', JSON.stringify([]))
    h.session = sessionUI({ rows: rowsWithSelections(0) })
    // statusFilters set but inert in a session — it must not surface as a chip either.
    renderBar({ layoutId: 122, inSession: true, filters: state({ statusFilters: ['sent'] }) })
    expect(screen.queryByRole('button', { name: /^Remove Status/ })).toBeNull()
  })

  // applyFilters skips the per-member clause unless the projection is ready (filters.ts:
  // `ctx.session.ready && !matchesSessionStatus(...)`), so while it is paused or loading the list
  // shows EVERYTHING. The header must not claim a filter the list is not applying — and paused is
  // routine, not exceptional: the projection carries a 5-minute max-age.
  it.each(['paused', 'loading'] as const)(
    'reports status inactive while the projection is %s, even with selections',
    (state) => {
      localStorage.setItem('catalogPinnedFilters_130', JSON.stringify(['status']))
      h.session = sessionUI({ rows: rowsWithSelections(2), state })
      renderBar({ layoutId: 130, inSession: true })
      // Bare facet name, not "Status (2)" — and no accent-filled "on" control.
      expect(screen.getByRole('button', { name: 'Ascent status' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Status (2)' })).toBeNull()
    },
  )

  it('emits no status chip while the projection is paused, even with selections', () => {
    localStorage.setItem('catalogPinnedFilters_131', JSON.stringify([]))
    h.session = sessionUI({ rows: rowsWithSelections(2), state: 'paused' })
    renderBar({ layoutId: 131, inSession: true })
    expect(screen.queryByRole('button', { name: /^Remove Status/ })).toBeNull()
  })

  it('keeps Clear reachable in the paused popover — selections exist even though nothing filters', () => {
    // The two questions differ: "is it filtering?" (no, paused) vs "is there something to clear?"
    // (yes). Gating Clear on the former would strand selections the user can see in the rows.
    localStorage.setItem('catalogPinnedFilters_132', JSON.stringify(['status']))
    const onClearAll = vi.fn()
    h.session = sessionUI({ rows: rowsWithSelections(1), state: 'paused', onClearAll })
    renderBar({ layoutId: 132, inSession: true })
    fireEvent.click(screen.getByRole('button', { name: 'Ascent status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClearAll).toHaveBeenCalled()
  })

  it('does not duplicate status as both the pinned control and a chip', () => {
    localStorage.setItem('catalogPinnedFilters_123', JSON.stringify(['status']))
    h.session = sessionUI({ rows: rowsWithSelections(2) })
    renderBar({ layoutId: 123, inSession: true })
    expect(screen.getByRole('button', { name: 'Status (2)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Status (2) filter' })).toBeNull()
  })
})

describe('FilterPillBar — source facet (U6)', () => {
  it('shows an unpinned active source as a removable chip labelled with its value', () => {
    localStorage.setItem('catalogPinnedFilters_140', JSON.stringify([]))
    renderBar({ layoutId: 140, filters: state({ source: 'mine' }) })
    expect(screen.getByRole('button', { name: 'Remove Mine filter' })).toBeInTheDocument()
  })

  it('clears the facet when the chip is removed', () => {
    localStorage.setItem('catalogPinnedFilters_141', JSON.stringify([]))
    const onChange = vi.fn()
    renderBar({ layoutId: 141, filters: state({ source: 'community' }), onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Community filter' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: null }))
  })

  it('shows a pinned source facet as a control (labelled by value when active)', () => {
    localStorage.setItem('catalogPinnedFilters_142', JSON.stringify(['source']))
    renderBar({ layoutId: 142, filters: state({ source: 'community' }) })
    expect(screen.getByRole('button', { name: 'Community' })).toBeInTheDocument()
    // Never both a control and a chip.
    expect(screen.queryByRole('button', { name: /^Remove .* filter$/ })).toBeNull()
  })

  it('keeps a pinned source control usable when signed out (Community browses public problems)', () => {
    localStorage.setItem('catalogPinnedFilters_143', JSON.stringify(['source']))
    renderBar({ layoutId: 143, signedOut: true })
    expect(screen.getByRole('button', { name: 'Custom problems' })).toBeInTheDocument()
  })
})
