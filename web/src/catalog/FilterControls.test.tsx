import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterControls } from './FilterControls'
import type { SessionFilterUI } from './useSessionFilterRows'
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

// FilterControls now reads session rows from the store hook (no prop drilling); control it here.
const h = vi.hoisted(() => ({ session: undefined as SessionFilterUI | undefined }))
vi.mock('./useSessionFilterRows', () => ({ useSessionFilterRows: () => h.session }))

beforeEach(() => {
  h.session = undefined
})

const gradeSpan: [number, number] = [3, 15]
const board = boardByLayoutId(7)!

function setup(
  over: Partial<FilterState> = {},
  auth: { statusReady?: boolean; signedOut?: boolean } = {},
  boardLists: SavedList[] = [],
) {
  const state = { ...DEFAULT_FILTERS, ...over }
  const onChange = vi.fn()
  render(
    <FilterControls
      state={state}
      onChange={onChange}
      board={board}
      gradeSpan={gradeSpan}
      statusReady={auth.statusReady ?? true}
      signedOut={auth.signedOut ?? false}
      boardLists={boardLists}
    />,
  )
  return { onChange }
}

describe('FilterControls', () => {
  it('toggles the benchmark filter', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Benchmarks' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ benchmarkOnly: true }))
  })

  it('shows the fixed foot-rule method options regardless of slab contents', () => {
    setup()
    for (const label of ['No kickboard', 'Footless', 'Footless + kickboard']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('toggles a method chip', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByText('Footless'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ methods: ['Footless'] }))
  })

  it('omits the "Saved lists" section when the board has no lists', () => {
    setup()
    expect(screen.queryByText('Saved lists')).toBeNull()
  })

  it('shows a pill per saved list and toggles it into listFilter', () => {
    const { onChange } = setup({}, {}, [savedList('a', 'Projects'), savedList('b', 'Warm-ups')])
    expect(screen.getByText('Saved lists')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ listFilter: ['a'] }))
  })

  it('un-toggles a selected list pill, removing just that id', () => {
    const { onChange } = setup({ listFilter: ['a', 'b'] }, {}, [
      savedList('a', 'Projects'),
      savedList('b', 'Warm-ups'),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ listFilter: ['b'] }))
  })

  it('toggles status chips (multi-select) when signed in', () => {
    const { onChange } = setup({ statusFilters: ['sent'] })
    // 'Sent' already pressed; add 'Not logged'.
    fireEvent.click(screen.getByRole('button', { name: 'Not logged' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ statusFilters: ['sent', 'unlogged'] }),
    )
  })

  it('keeps the canonical wording on each status option’s title', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Tried' })).toHaveAttribute('title', 'Attempted')
  })

  it('disables status chips with a sign-in hint when signed out', () => {
    setup({}, { signedOut: true, statusReady: false })
    expect(screen.getByText('Sign in to filter by status')).toBeInTheDocument()
    const sent = screen.getByRole('button', { name: 'Sent' })
    expect(sent).toBeDisabled()
    expect(sent).toHaveAttribute('aria-describedby')
  })

  it('disables status chips WITHOUT a sign-in hint while signed in but ascents not loaded', () => {
    // statusReady false (ascents loading/error) but not signedOut: chips must be
    // disabled (a pressed chip can't imply an unapplied filter) yet show no sign-in hint.
    setup({ statusFilters: ['sent'] }, { signedOut: false, statusReady: false })
    expect(screen.getByRole('button', { name: 'Sent' })).toBeDisabled()
    expect(screen.queryByText('Sign in to filter by status')).toBeNull()
  })
})

// ── U5: per-member session status rows ──
function sessionSetup(over: Partial<SessionFilterUI> = {}) {
  const onRefresh = vi.fn()
  const rows: SessionFilterUI['rows'] = over.rows ?? [
    { userId: 'me', label: 'You', initials: 'ME', avatarUrl: null, isSelf: true, selected: [], onToggle: vi.fn() },
    { userId: 'alice', label: 'Alice', initials: 'AL', avatarUrl: null, isSelf: false, selected: ['sent'], onToggle: vi.fn() },
    { userId: 'bob', label: 'Bob', initials: 'BO', avatarUrl: null, isSelf: false, selected: [], onToggle: vi.fn() },
  ]
  h.session = { rows, state: over.state ?? 'ready', onRefresh, onClearAll: vi.fn() }
  render(
    <FilterControls
      state={DEFAULT_FILTERS}
      onChange={vi.fn()}
      board={board}
      gradeSpan={gradeSpan}
      statusReady
      signedOut={false}
      boardLists={[]}
    />,
  )
  return { rows, onRefresh }
}

describe('FilterControls — per-member session status (U5)', () => {
  it('renders one row per member, self labeled "You" and first, each an accessible group', () => {
    sessionSetup()
    const groups = screen
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'))
      .filter((l) => l?.endsWith('ascent status'))
    expect(groups).toEqual(['Your ascent status', 'Alice’s ascent status', 'Bob’s ascent status'])
    // Every member's name is VISIBLE text, not an avatar tooltip — there is no hover on a phone,
    // so an avatar-only row would be unidentifiable to touch users.
    for (const name of ['You', 'Alice', 'Bob']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('ME')).toBeInTheDocument()
  })

  it('welds each member’s three statuses into one segmented control, labelled to fit one line', () => {
    sessionSetup()
    const you = screen.getByRole('group', { name: 'Your ascent status' })
    // The shared picker wording — identical in the sheet's single-user row and the pinned
    // control's solo body, with the canonical form on each option's title.
    expect(within(you).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Sent',
      'Tried',
      'Not logged',
    ])
    expect(within(you).getByRole('button', { name: 'Tried' })).toHaveAttribute(
      'title',
      'Attempted',
    )
  })

  it('loading state marks rows aria-busy and non-interactive', () => {
    sessionSetup({ state: 'loading' })
    const you = screen.getByRole('group', { name: 'Your ascent status' })
    expect(you).toHaveAttribute('aria-busy', 'true')
    expect(within(you).getByRole('button', { name: 'Sent' })).toBeDisabled()
  })

  it('paused state shows the "filtering paused" affordance, keeps selections, and refreshes', () => {
    const { onRefresh } = sessionSetup({ state: 'paused' })
    expect(screen.getByText(/cross-member filtering paused/i)).toBeInTheDocument()
    // last-good selections retained + interactive
    const alice = screen.getByRole('group', { name: 'Alice’s ascent status' })
    expect(within(alice).getByRole('button', { name: 'Sent' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('toggling a member chip calls that member row onToggle', () => {
    // Guards the segmented control's contract: the group is fully controlled off row.selected and
    // must still report per-KEY toggles, so the sessions store stays the single source of truth.
    const { rows } = sessionSetup()
    const you = screen.getByRole('group', { name: 'Your ascent status' })
    fireEvent.click(within(you).getByRole('button', { name: 'Not logged' }))
    expect(rows[0].onToggle).toHaveBeenCalledWith('unlogged', true)
  })

  it('un-toggling an already-selected segment reports active=false, not a replaced selection', () => {
    // Alice has 'sent' on. A segmented control that swapped its value instead of toggling would
    // silently turn multi-select into single-select — OR-within-a-member is the predicate.
    const { rows } = sessionSetup()
    const alice = screen.getByRole('group', { name: 'Alice’s ascent status' })
    fireEvent.click(within(alice).getByRole('button', { name: 'Sent' }))
    expect(rows[1].onToggle).toHaveBeenCalledWith('sent', false)
  })
})

describe('FilterControls — source facet (U6)', () => {
  it('selects a source', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Community' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'community' }))
  })

  it('clears the facet by tapping the value that is already pressed', () => {
    const { onChange } = setup({ source: 'community' })
    fireEvent.click(screen.getByRole('button', { name: 'Community' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: null }))
  })

  it('replaces the other value rather than combining them (mutually exclusive)', () => {
    const { onChange } = setup({ source: 'mine' })
    fireEvent.click(screen.getByRole('button', { name: 'Community' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'community' }))
  })

  it('disables "Mine" when signed out but keeps "Community" browsable', () => {
    setup({}, { signedOut: true })
    expect(screen.getByRole('button', { name: 'Mine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Community' })).not.toBeDisabled()
    expect(screen.getByText('Sign in to filter by your own problems')).toBeInTheDocument()
  })
})
