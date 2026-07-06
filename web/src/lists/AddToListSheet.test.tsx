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

// Router Link → a plain anchor so the sheet mounts in isolation (no route tree).
// Forward `to`/`params` as data-attrs so the navigation target is assertable.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    onClick,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: { listId?: string }
    onClick?: (e: React.MouseEvent) => void
  } & Record<string, unknown>) => (
    <a
      href="#"
      data-to={to}
      data-list-id={params?.listId}
      onClick={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}))

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

  it('each list row links to that list and closes the sheet on navigate', async () => {
    lists = [savedList('l7', 'Sevens', 7)]
    const onOpenChange = vi.fn()
    render(<AddToListSheet open onOpenChange={onOpenChange} sourceCatalogId="cat-1" board={board} />)

    const link = await screen.findByRole('link', { name: 'Open Sevens' })
    expect(link).toHaveAttribute('data-to', '/lists/$listId')
    expect(link).toHaveAttribute('data-list-id', 'l7')
    fireEvent.click(link)
    expect(onOpenChange).toHaveBeenCalledWith(false)
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

  it('a same-tick double-submit of the new-list form creates only one list', async () => {
    createList.mockResolvedValue(savedList('new', 'Warmups', 7))
    mount()
    fireEvent.change(await screen.findByLabelText('New list name'), { target: { value: 'Warmups' } })

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
    // Two submits in the same tick, before React re-renders the disabled state — the
    // synchronous creatingRef lock must swallow the second (no duplicate list).
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(createList).toHaveBeenCalledTimes(1))
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

  it('the date pill opens the calendar and fills the name with the picked day', async () => {
    lists = []
    mount()
    // Open the calendar popover from its sibling pill.
    fireEvent.click(await screen.findByRole('button', { name: 'Name the list by date' }))
    expect(await screen.findByRole('grid')).toBeInTheDocument()

    // Click a day cell (buttons whose label is just a number) → it fills the name field
    // with a formatted date and closes the popover.
    const dayButton = screen
      .getAllByRole('button')
      .find((b) => /^\d{1,2}$/.test((b.textContent ?? '').trim()))
    expect(dayButton).toBeDefined()
    fireEvent.click(dayButton!)

    await waitFor(() => {
      const input = screen.getByRole('textbox', { name: 'New list name' }) as HTMLInputElement
      expect(input.value).toMatch(/^\w{3}, \w{3} \d{1,2}$/)
    })
  })

  it('with no lists, the create form is the empty state — no dashed box or "pick a list" hint', async () => {
    lists = [savedList('l5', 'Fives', 5)] // different board → this board has none
    mount()
    // The create form heads itself with the first-list prompt...
    expect(await screen.findByText('Create your first list')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'New list name' })).toBeInTheDocument()
    // ...and the "pick a list" description is dropped so nothing double-stacks.
    expect(screen.queryByText(/Pick a list/)).toBeNull()
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
