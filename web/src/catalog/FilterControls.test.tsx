import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterControls, type SessionFilterUI } from './FilterControls'

const gradeSpan: [number, number] = [3, 15]
const board = boardByLayoutId(7)!

function setup(over: Partial<FilterState> = {}, auth: { statusReady?: boolean; signedOut?: boolean } = {}) {
  const state = { ...DEFAULT_FILTERS, ...over }
  const onChange = vi.fn()
  render(
    <FilterControls
      state={state}
      onChange={onChange}
      board={board}
      gradeSpan={gradeSpan}
      methods={['Footless', 'No kickboard']}
      statusReady={auth.statusReady ?? true}
      signedOut={auth.signedOut ?? false}
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

  it('toggles a method chip', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByText('Footless'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ methods: ['Footless'] }))
  })

  it('toggles status chips (multi-select) when signed in', () => {
    const { onChange } = setup({ statusFilters: ['sent'] })
    // 'Sent' already pressed; add 'Not logged'.
    fireEvent.click(screen.getByRole('button', { name: 'Not logged' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ statusFilters: ['sent', 'unlogged'] }),
    )
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
    { userId: 'me', label: 'You', isSelf: true, selected: [], onToggle: vi.fn() },
    { userId: 'alice', label: 'Alice', isSelf: false, selected: ['sent'], onToggle: vi.fn() },
    { userId: 'bob', label: 'Bob', isSelf: false, selected: [], onToggle: vi.fn() },
  ]
  const session: SessionFilterUI = { rows, state: over.state ?? 'ready', onRefresh }
  render(
    <FilterControls
      state={DEFAULT_FILTERS}
      onChange={vi.fn()}
      board={board}
      gradeSpan={gradeSpan}
      methods={[]}
      statusReady
      signedOut={false}
      session={session}
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
    expect(screen.getByText('You')).toBeInTheDocument()
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
    const { rows } = sessionSetup()
    const you = screen.getByRole('group', { name: 'Your ascent status' })
    fireEvent.click(within(you).getByRole('button', { name: 'Not logged' }))
    expect(rows[0].onToggle).toHaveBeenCalledWith('unlogged', true)
  })
})
