import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterSheet } from './FilterSheet'

const board = boardByLayoutId(7)!

async function open(
  over: Partial<FilterState> = {},
  auth: { statusReady?: boolean; signedOut?: boolean } = {},
) {
  const onChange = vi.fn()
  render(
    <FilterSheet
      state={{ ...DEFAULT_FILTERS, ...over }}
      onChange={onChange}
      board={board}
      gradeSpan={[3, 15]}
      statusReady={auth.statusReady ?? true}
      signedOut={auth.signedOut ?? false}
      boardLists={[]}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  await screen.findByRole('dialog')
  return { onChange }
}

describe('FilterSheet — Clear filters (header)', () => {
  it('hides Clear filters when no filter is active', async () => {
    await open()
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()
  })

  it('shows Clear filters when a filter is active and clears on click', async () => {
    const { onChange } = await open({ benchmarkOnly: true })
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ benchmarkOnly: false }))
  })

  it('hides Clear filters for a signed-out ?status= link (status does not count)', async () => {
    // A shared ?status=sent link decodes statusFilters while signed out; since
    // statusReady is false the status filter is inert, so Clear must stay hidden.
    await open({ statusFilters: ['sent'] }, { statusReady: false, signedOut: true })
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()
  })
})
