import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SetterOption } from './filters'
import { SetterFilterSheet } from './SetterFilterSheet'
import { SETTER_LIST_CAP, problemCountLabel, visibleSetters } from './visibleSetters'

const options: SetterOption[] = [
  { name: 'Kyle Knapp', count: 512 },
  { name: 'Ben Moon', count: 15 },
  { name: 'Tonip', count: 3 },
  { name: 'kyle knapp', count: 0 },
]

function renderSheet(over: Partial<Parameters<typeof SetterFilterSheet>[0]> = {}) {
  const getOptions = vi.fn(() => options)
  const onChange = vi.fn()
  render(
    <SetterFilterSheet
      open={over.open ?? true}
      onOpenChange={over.onOpenChange ?? (() => {})}
      getOptions={over.getOptions ?? getOptions}
      selected={over.selected ?? []}
      onChange={over.onChange ?? onChange}
    />,
  )
  return { getOptions, onChange }
}

describe('visibleSetters', () => {
  it('pins selected setters first (selection order), then the rest in option order, capped', () => {
    const { rows, hidden } = visibleSetters(options, ['Tonip', 'Ben Moon'], '', 1)
    expect(rows.map((r) => r.name)).toEqual(['Tonip', 'Ben Moon', 'Kyle Knapp'])
    expect(hidden).toBe(1)
  })

  it('keeps a selected setter that is absent from the slab, at count 0, so it can be removed', () => {
    const { rows } = visibleSetters(options, ['Nobody'], '')
    expect(rows[0]).toEqual({ name: 'Nobody', count: 0 })
  })

  it('filters the unselected rows by a case-insensitive, trimmed substring of the name', () => {
    const { rows, hidden } = visibleSetters(options, [], '  KNAPP ')
    expect(rows.map((r) => r.name)).toEqual(['Kyle Knapp', 'kyle knapp'])
    expect(hidden).toBe(0)
  })

  it('defaults the cap to SETTER_LIST_CAP', () => {
    const many = Array.from({ length: SETTER_LIST_CAP + 7 }, (_, i) => ({ name: `s${i}`, count: 1 }))
    const { rows, hidden } = visibleSetters(many, [], '')
    expect(rows).toHaveLength(SETTER_LIST_CAP)
    expect(hidden).toBe(7)
  })
})

describe('problemCountLabel', () => {
  it('spells the count out in the app\'s own word, singular at one, and says so at zero', () => {
    expect(problemCountLabel(512)).toBe('512 problems')
    expect(problemCountLabel(1)).toBe('1 problem')
    expect(problemCountLabel(0)).toBe('No problems match')
  })
})

describe('SetterFilterSheet', () => {
  it('lists setters with the count captioned under the name and marks the selected ones pressed', () => {
    renderSheet({ selected: ['Ben Moon'] })
    expect(screen.getByRole('button', { name: 'Remove Ben Moon from the filter' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const kyle = screen.getByRole('button', { name: 'Filter by Kyle Knapp, 512 problems' })
    expect(kyle).toHaveAttribute('aria-pressed', 'false')
    expect(kyle).toHaveTextContent('512 problems')
    expect(screen.getByRole('button', { name: /kyle knapp, No problems match/ })).toHaveTextContent('No problems match')
  })

  it('has no description line — the captions explain the numbers', () => {
    renderSheet()
    expect(screen.queryByText(/pass your other filters/)).toBeNull()
  })

  it('does not compute the options while closed', () => {
    const { getOptions } = renderSheet({ open: false })
    expect(getOptions).not.toHaveBeenCalled()
  })

  it('toggling an unselected setter adds it (live, no Apply step)', () => {
    const { onChange } = renderSheet({ selected: ['Ben Moon'] })
    fireEvent.click(screen.getByRole('button', { name: /Filter by Tonip/ }))
    expect(onChange).toHaveBeenCalledWith(['Ben Moon', 'Tonip'])
  })

  it('toggling a selected setter removes just that name', () => {
    const { onChange } = renderSheet({ selected: ['Ben Moon', 'Tonip'] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben Moon from the filter' }))
    expect(onChange).toHaveBeenCalledWith(['Tonip'])
  })

  it('narrows the list as you type and reports no matches', () => {
    renderSheet()
    const search = screen.getByRole('searchbox', { name: 'Search setters' })
    fireEvent.change(search, { target: { value: 'moon' } })
    expect(screen.getByRole('button', { name: /Filter by Ben Moon/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Filter by Kyle Knapp/ })).toBeNull()
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('No setters match “zzz”')).toBeInTheDocument()
  })

  it('caps the list and says how many more the search reaches', () => {
    const many = Array.from({ length: SETTER_LIST_CAP + 25 }, (_, i) => ({ name: `Setter ${i}`, count: 1 }))
    renderSheet({ getOptions: () => many })
    expect(screen.getAllByRole('button', { name: /^Filter by/ })).toHaveLength(SETTER_LIST_CAP)
    expect(screen.getByText('25 more setters — type to search')).toBeInTheDocument()
  })

  it('shows "Clear all" only with a selection, and it clears every name', () => {
    const { onChange } = renderSheet({ selected: [] })
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
    const { onChange: onChange2 } = renderSheet({ selected: ['Ben Moon', 'Tonip'] })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange2).toHaveBeenCalledWith([])
    expect(onChange).not.toHaveBeenCalled()
  })
})
