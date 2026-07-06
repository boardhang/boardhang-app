import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boardByLayoutId } from '../board/boards'
import type { SavedList } from './listsTypes'
import { AddToListSheet } from './AddToListSheet'

const authStatus = { value: 'signedInWithProfile' as string }
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ status: authStatus.value }),
}))

let lists: SavedList[] = []
let changeListener: (() => void) | null = null
const createList = vi.fn()
const addProblem = vi.fn().mockResolvedValue(undefined)
const removeProblem = vi.fn().mockResolvedValue(undefined)
const loadLists = vi.fn().mockResolvedValue(undefined)
vi.mock('./listsStore', () => ({
  useSavedLists: () => ({ status: 'loaded', lists, error: null }),
  createList: (...a: unknown[]) => createList(...a),
  addProblem: (...a: unknown[]) => addProblem(...a),
  removeProblem: (...a: unknown[]) => removeProblem(...a),
  loadLists: (...a: unknown[]) => loadLists(...a),
  subscribeListProblemsChanged: (cb: () => void) => {
    changeListener = cb
    return () => {
      changeListener = null
    }
  },
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

const sheet = () => <AddToListSheet open onOpenChange={() => {}} sourceCatalogId="cat-1" board={board} />

function mount() {
  return render(sheet())
}

beforeEach(() => {
  vi.clearAllMocks()
  authStatus.value = 'signedInWithProfile'
  lists = []
  changeListener = null
  listIdsContaining.mockResolvedValue(new Set<string>())
})

function defer<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

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

  it('create succeeds but add fails: shows an add-failed toast, not create-failed (#7)', async () => {
    createList.mockResolvedValue(savedList('new', 'Warmups', 7))
    addProblem.mockRejectedValueOnce(new Error('offline'))
    mount()

    fireEvent.change(await screen.findByLabelText('New list name'), { target: { value: 'Warmups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const [message, opts] = toastError.mock.calls[0] as [string, { action?: { label: string } }]
    expect(message).toBe('List created, but the problem wasn’t added.')
    expect(opts.action?.label).toBe('Retry')
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

  it('rapid membership notifies apply the latest read, not a stale one (#3)', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    // Mount read: currently a member.
    listIdsContaining.mockResolvedValueOnce(new Set(['l7']))
    mount()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sevens/ })).toHaveAttribute('aria-pressed', 'true'),
    )

    // Two rapid notifies: read A (issued first) resolves LAST with a stale "member" set;
    // read B (issued second) resolves first with the fresh "not a member" set.
    const first = defer<Set<string>>()
    const second = defer<Set<string>>()
    listIdsContaining.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    changeListener!() // read A (stale)
    changeListener!() // read B (fresh, latest)

    second.resolve(new Set<string>())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sevens/ })).toHaveAttribute('aria-pressed', 'false'),
    )

    first.resolve(new Set(['l7'])) // stale, must be ignored
    await Promise.resolve()
    expect(screen.getByRole('button', { name: /Sevens/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hydrates the store on open so catalog-cold lists render, not the empty state (BUG A)', async () => {
    // Store is empty on open (never visited /lists this page-load).
    lists = []
    const { rerender } = mount()
    await waitFor(() => expect(loadLists).toHaveBeenCalled())
    expect(screen.getByText('Create your first list')).toBeInTheDocument()

    // loadLists populates the store with a matching-board list → it renders.
    lists = [savedList('l7', 'Sevens', 7)]
    rerender(sheet())
    expect(await screen.findByText('Sevens')).toBeInTheDocument()
    expect(screen.queryByText('Create your first list')).toBeNull()
  })

  it('an in-flight toggle blocks a concurrent double-fire on the same list (BUG B)', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    addProblem.mockReturnValue(new Promise(() => {})) // never resolves → stays in flight
    mount()

    const row = await screen.findByRole('button', { name: /Sevens/ })
    fireEvent.click(row)
    fireEvent.click(row) // blocked (disabled + in-flight ref guard)

    expect(addProblem).toHaveBeenCalledTimes(1)
    expect(removeProblem).not.toHaveBeenCalled()
  })
})
