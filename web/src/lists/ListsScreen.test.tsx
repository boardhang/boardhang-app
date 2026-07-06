import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/renderWithRouter'
import type { ListsState } from './listsStore'
import type { SavedList } from './listsTypes'

// Auth: a configurable useAuth; AuthProvider passes children through.
const authState = {
  status: 'signedInWithProfile' as string,
  profile: null,
  isRestoring: false,
  isConfigured: true,
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  signInWithGoogle: vi.fn(),
  isHandleAvailable: vi.fn(),
  saveProfile: vi.fn(),
}
vi.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => authState,
}))

// Store: a configurable snapshot + spy actions.
let storeState: ListsState = { status: 'loaded', lists: [], error: null }
const createList = vi.fn().mockResolvedValue(undefined)
const renameList = vi.fn().mockResolvedValue(undefined)
const deleteList = vi.fn().mockResolvedValue(undefined)
vi.mock('./listsStore', () => ({
  useSavedLists: () => storeState,
  loadLists: vi.fn().mockResolvedValue(undefined),
  refreshLists: vi.fn().mockResolvedValue(undefined),
  createList: (...a: unknown[]) => createList(...a),
  renameList: (...a: unknown[]) => renameList(...a),
  deleteList: (...a: unknown[]) => deleteList(...a),
  subscribeListProblemsChanged: () => () => {},
}))

const counts = vi.fn().mockResolvedValue(new Map<string, number>())
vi.mock('./listsSync', () => ({
  countListProblems: () => counts(),
}))

function savedList(id: string, name: string, createdAt: string): SavedList {
  return {
    id,
    ownerId: 'user-A',
    name,
    boardLayoutId: 7,
    createdAt,
    updatedAt: createdAt,
    deleted: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.status = 'signedInWithProfile'
  storeState = { status: 'loaded', lists: [], error: null }
  counts.mockResolvedValue(new Map<string, number>())
})

describe('ListsScreen', () => {
  it('signed out: shows the sign-in card, not the list UI', async () => {
    authState.status = 'signedOut'
    renderWithRouter('/lists')
    expect(await screen.findByText('Sign in to save lists')).toBeInTheDocument()
    expect(screen.queryByLabelText('New list name')).toBeNull()
  })

  it('loaded with lists: rows show name, board label, count, newest first', async () => {
    storeState = {
      status: 'loaded',
      lists: [
        savedList('b', 'Newer', '2026-07-06T02:00:00Z'),
        savedList('a', 'Older', '2026-07-06T01:00:00Z'),
      ],
      error: null,
    }
    counts.mockResolvedValue(new Map([['b', 3]]))
    renderWithRouter('/lists')

    expect(await screen.findByText('Newer')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()
    // Board label derived from Mini MoonBoard 2025 and the live count.
    expect(await screen.findByText('Mini 2025 · 3 problems')).toBeInTheDocument()

    // Newest first: 'Newer' precedes 'Older' in the DOM.
    const names = screen.getAllByText(/Newer|Older/).map((n) => n.textContent)
    expect(names).toEqual(['Newer', 'Older'])
  })

  it('loaded with zero rows: shows the create-first-list empty state', async () => {
    storeState = { status: 'loaded', lists: [], error: null }
    renderWithRouter('/lists')
    expect(await screen.findByText('Create your first list')).toBeInTheDocument()
  })

  it('offline status: shows the cant-reach state with retry, NOT the empty state', async () => {
    storeState = { status: 'offline', lists: [], error: null }
    renderWithRouter('/lists')
    expect(await screen.findByTestId('lists-offline')).toBeInTheDocument()
    expect(screen.getByText('Can’t reach your lists')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('Create your first list')).toBeNull()
  })

  it('create: entering a name calls createList; a blank name is rejected', async () => {
    renderWithRouter('/lists')
    const input = await screen.findByLabelText('New list name')
    const createBtn = screen.getByRole('button', { name: 'Create' })

    // Blank → the button is disabled and nothing is created.
    expect(createBtn).toBeDisabled()

    fireEvent.change(input, { target: { value: 'Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(createList).toHaveBeenCalledWith('Projects', expect.any(Number))
  })

  it('rename inline updates the row', async () => {
    storeState = {
      status: 'loaded',
      lists: [savedList('a', 'Warmups', '2026-07-06T01:00:00Z')],
      error: null,
    }
    renderWithRouter('/lists')

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Warmups' }))
    const input = await screen.findByLabelText('Rename Warmups')
    fireEvent.change(input, { target: { value: 'Warm-ups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(renameList).toHaveBeenCalledWith('a', 'Warm-ups')
  })

  it('delete asks to confirm, then removes', async () => {
    storeState = {
      status: 'loaded',
      lists: [savedList('a', 'Trash me', '2026-07-06T01:00:00Z')],
      error: null,
    }
    renderWithRouter('/lists')

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Trash me' }))
    // Confirm drawer.
    expect(await screen.findByText('Delete “Trash me”?')).toBeInTheDocument()
    const confirm = screen.getAllByRole('button', { name: 'Delete' }).at(-1)!
    fireEvent.click(confirm)
    await waitFor(() => expect(deleteList).toHaveBeenCalledWith('a'))
  })

  it('error status surfaces an error note', async () => {
    storeState = { status: 'error', lists: [], error: 'kaboom' }
    renderWithRouter('/lists')
    expect(await screen.findByText(/Couldn’t load your lists: kaboom/)).toBeInTheDocument()
  })
})
