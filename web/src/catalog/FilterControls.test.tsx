import { fireEvent, render, renderHook, screen, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterControls } from './FilterControls'
import { useFilters } from './useFilters'

const gradeSpan: [number, number] = [3, 15]

function setup(over: Partial<FilterState> = {}) {
  const state = { ...DEFAULT_FILTERS, ...over }
  const onChange = vi.fn()
  render(
    <FilterControls
      state={state}
      onChange={onChange}
      gradeSpan={gradeSpan}
      methods={['Footless', 'No kickboard']}
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

  it('shows Reset only when a filter is active, and resets on click', () => {
    setup() // no active filters
    expect(screen.queryByRole('button', { name: /reset filters/i })).toBeNull()

    const { onChange } = setup({ benchmarkOnly: true })
    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ benchmarkOnly: false }))
  })
})

describe('useFilters', () => {
  beforeEach(() => localStorage.clear())

  it('persists filter state per slab and reloads it', () => {
    const { result, rerender } = renderHook(({ l, a }) => useFilters(l, a), {
      initialProps: { l: 7, a: 40 },
    })
    act(() => result.current[1]({ ...DEFAULT_FILTERS, benchmarkOnly: true }))
    expect(result.current[0].benchmarkOnly).toBe(true)

    // A different slab starts clean...
    rerender({ l: 5, a: 25 })
    expect(result.current[0].benchmarkOnly).toBe(false)

    // ...and returning restores the persisted state.
    rerender({ l: 7, a: 40 })
    expect(result.current[0].benchmarkOnly).toBe(true)
  })
})
