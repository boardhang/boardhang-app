import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import { DEFAULT_FILTERS, type FilterState } from './filters'
import { FilterSheet } from './FilterSheet'
import type { SessionFilterUI } from './useSessionFilterRows'

// The sheet reads session rows from the store hook (badge count + Clear); control them here.
const h = vi.hoisted(() => ({ session: undefined as SessionFilterUI | undefined }))
vi.mock('./useSessionFilterRows', () => ({ useSessionFilterRows: () => h.session }))

beforeEach(() => {
  h.session = undefined
})

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

// Per-member session status is counted by the FAB badge, so "Clear filters" has to be able to
// clear it — resetFilters can't (it only returns a FilterState).
function sessionRow(userId: string, selected: SessionFilterUI['rows'][number]['selected']) {
  return { userId, label: userId, initials: 'XX', avatarUrl: null, isSelf: false, selected, onToggle: vi.fn() }
}

describe('FilterSheet — Clear filters in a session', () => {
  it('shows Clear filters when only a per-member status is selected, and clears it', async () => {
    const onClearAll = vi.fn()
    h.session = { rows: [sessionRow('me', ['sent'])], state: 'ready', onRefresh: vi.fn(), onClearAll }
    const { onChange } = await open()
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onClearAll).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
  })

  it('hides Clear filters when only the inert single-user statusFilters is set in a session', async () => {
    h.session = { rows: [sessionRow('me', [])], state: 'ready', onRefresh: vi.fn(), onClearAll: vi.fn() }
    await open({ statusFilters: ['sent'] })
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()
  })
})
