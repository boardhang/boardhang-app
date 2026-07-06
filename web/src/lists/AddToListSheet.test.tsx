import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { SavedList } from './listsTypes'
import { AddToListSheet } from './AddToListSheet'

let lists: SavedList[] = []
const createList = vi.fn()
const addProblem = vi.fn().mockResolvedValue(undefined)
const removeProblem = vi.fn().mockResolvedValue(undefined)
vi.mock('./listsStore', () => ({
  useSavedLists: () => ({ status: 'loaded', lists, error: null }),
  createList: (...a: unknown[]) => createList(...a),
  addProblem: (...a: unknown[]) => addProblem(...a),
  removeProblem: (...a: unknown[]) => removeProblem(...a),
  subscribeListProblemsChanged: () => () => {},
}))

const listIdsContaining = vi.fn().mockResolvedValue(new Set<string>())
vi.mock('./listsSync', () => ({
  listIdsContaining: (...a: unknown[]) => listIdsContaining(...a),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }))

const board = boardByLayoutId(7)!

function savedList(id: string, name: string, boardLayoutId: number): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId,
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    deleted: false,
  }
}

function mount() {
  return render(
    <AddToListSheet open onOpenChange={() => {}} sourceCatalogId="cat-1" board={board} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  lists = []
  listIdsContaining.mockResolvedValue(new Set<string>())
})

describe('AddToListSheet', () => {
  it('shows only lists for the current board, with membership checkmarks', async () => {
    lists = [savedList('l7', 'Sevens', 7), savedList('l5', 'Fives', 5)]
    listIdsContaining.mockResolvedValue(new Set(['l7']))
    mount()

    expect(await screen.findByText('Sevens')).toBeInTheDocument()
    expect(screen.queryByText('Fives')).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sevens/ })).toHaveAttribute('aria-pressed', 'true'),
    )
  })

  it('toggling a non-member list adds the problem', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    listIdsContaining.mockResolvedValue(new Set<string>())
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Sevens/ }))
    expect(addProblem).toHaveBeenCalledWith('l7', 'cat-1', 7)
  })

  it('toggling a member list removes the problem', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    listIdsContaining.mockResolvedValue(new Set(['l7']))
    mount()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sevens/ })).toHaveAttribute('aria-pressed', 'true'),
    )
    fireEvent.click(screen.getByRole('button', { name: /Sevens/ }))
    expect(removeProblem).toHaveBeenCalledWith('l7', 'cat-1')
  })

  it('a failed toggle rolls back and shows a Retry toast', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    addProblem.mockRejectedValueOnce(new Error('offline'))
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /Sevens/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const [message, opts] = toastError.mock.calls[0] as [string, { action: { label: string } }]
    expect(message).toBe('Could not add to the list.')
    expect(opts.action.label).toBe('Retry')
  })

  it('New list creates a board-bound list and adds the current problem', async () => {
    createList.mockResolvedValue(savedList('new', 'Warmups', 7))
    mount()

    const input = await screen.findByLabelText('New list name')
    fireEvent.change(input, { target: { value: 'Warmups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createList).toHaveBeenCalledWith('Warmups', 7))
    await waitFor(() => expect(addProblem).toHaveBeenCalledWith('new', 'cat-1', 7))
  })

  it('rejects a blank new-list name (Save disabled)', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the empty state when there are no lists for this board', async () => {
    lists = [savedList('l5', 'Fives', 5)]
    mount()
    expect(await screen.findByText('Create your first list')).toBeInTheDocument()
  })
})
