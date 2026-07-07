import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterControls } from './FilterControls'

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
