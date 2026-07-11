import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedList } from '../lists/listsTypes'
import { ListFilterSheet } from './ListFilterSheet'

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

const boardLists = [savedList('a', 'Projects'), savedList('b', 'Warm-ups')]

describe('ListFilterSheet', () => {
  it('lists the board lists and marks the selected ones pressed', () => {
    render(
      <ListFilterSheet open onOpenChange={() => {}} boardLists={boardLists} selected={['a']} onChange={() => {}} />,
    )
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Warm-ups/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggling an unselected list adds it (live, no Apply step)', () => {
    const onChange = vi.fn()
    render(
      <ListFilterSheet open onOpenChange={() => {}} boardLists={boardLists} selected={['a']} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Warm-ups/ }))
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('toggling a selected list removes just that id', () => {
    const onChange = vi.fn()
    render(
      <ListFilterSheet open onOpenChange={() => {}} boardLists={boardLists} selected={['a', 'b']} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove Projects/ }))
    expect(onChange).toHaveBeenCalledWith(['b'])
  })

  it('shows "Clear all" only with a selection, and it clears every id', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ListFilterSheet open onOpenChange={() => {}} boardLists={boardLists} selected={[]} onChange={onChange} />,
    )
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()

    rerender(
      <ListFilterSheet open onOpenChange={() => {}} boardLists={boardLists} selected={['a', 'b']} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
