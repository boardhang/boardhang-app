import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { boardByLayoutId } from '../board/boards'
import type { CatalogProblem } from './catalogSync'
import { ProblemDetail } from './ProblemDetail'

// Callable `toast` (the copied path) plus `toast.error` (the failed path) — the mock at
// the top of ProblemDetail.test.tsx only stubs `.error` and would throw on `toast(...)`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// Signed out on purpose: sharing needs no account.
vi.mock('../auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ status: 'signedOut', profile: null, isRestoring: false, isConfigured: true }),
}))

vi.mock('../ble/useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

vi.mock('../lists/AddToListSheet', () => ({
  AddToListSheet: () => null,
}))
vi.mock('../auth/SignInDialog', () => ({
  SignInDialog: () => null,
}))

const board = boardByLayoutId(2)!

function problem(id: string, name: string, angle = 25): CatalogProblem {
  return {
    source_catalog_id: id,
    layout_id: 2,
    angle,
    name,
    grade: '7A',
    user_grade: null,
    setter: 'Alice',
    stars: 0,
    repeats: 0,
    is_benchmark: false,
    method: null,
    holds: [{ c: 0, r: 1, t: 'start' }],
  }
}

const p = problem('abc', 'Chunky Monkey')

function setNavigator(overrides: { share?: unknown; clipboard?: unknown }) {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(navigator, key, { value, configurable: true })
  }
}

// The host's route angle (40) deliberately differs from the row's (25): the link must
// come from the row (AE1).
function mount(current: CatalogProblem = p) {
  return render(
    <ProblemDetail
      problem={current}
      displayed={[current]}
      board={board}
      angle={40}
      favoriteIds={new Set()}
      sentIds={new Set()}
      onNavigate={() => {}}
    />,
  )
}

const expectedLink = `${window.location.origin}/board/2/catalog?angle=25&problem=abc`

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setNavigator({ share: undefined, clipboard: undefined })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ProblemDetail — Share button', () => {
  it('renders a Share button in the header without disturbing the toolbar actions', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Share problem' })).toBeInTheDocument()
    for (const name of ['Previous problem', 'Next problem', 'Save to list', 'Favorite']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /light up/i })).toBeInTheDocument()
  })

  it('shares the row-derived link through the native sheet with no toast (AE1, AE2)', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share, clipboard: { writeText: vi.fn() } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share problem' }))
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({
      title: 'Chunky Monkey 7A',
      text: 'Chunky Monkey 7A',
      url: expectedLink,
    })
    await flush()
    expect(toast).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('copies the link and toasts when there is no share API (AE4)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ clipboard: { writeText } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share problem' }))
    await flush()
    expect(writeText).toHaveBeenCalledWith(expectedLink)
    expect(toast).toHaveBeenCalledWith('Link copied')
  })

  it('shows an error toast carrying the link when nothing is available (AE5)', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share problem' }))
    await flush()
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [, opts] = vi.mocked(toast.error).mock.calls[0] as [string, { description?: string }]
    expect(opts.description).toContain(expectedLink)
  })

  it('ignores a second tap while a share is in flight and disables the button meanwhile', async () => {
    let resolveShare: () => void = () => {}
    const share = vi.fn(() => new Promise<void>((resolve) => (resolveShare = resolve)))
    setNavigator({ share, clipboard: { writeText: vi.fn() } })
    mount()
    const button = screen.getByRole('button', { name: 'Share problem' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(share).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => {
      resolveShare()
    })
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shares the currently shown problem after paging', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share, clipboard: { writeText: vi.fn() } })
    const { rerender } = mount()
    const next = problem('def', 'Second')
    rerender(
      <ProblemDetail
        problem={next}
        displayed={[next]}
        board={board}
        angle={40}
        favoriteIds={new Set()}
        sentIds={new Set()}
        onNavigate={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Share problem' }))
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('problem=def') }))
    await flush()
  })

  it('shows the error toast when the sheet rejects for a non-cancel reason and the clipboard also fails', async () => {
    const err = new Error('nope')
    err.name = 'NotAllowedError'
    setNavigator({
      share: vi.fn().mockRejectedValue(err),
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Share problem' }))
    await flush()
    expect(toast).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    const [, opts] = vi.mocked(toast.error).mock.calls[0] as [string, { description?: string }]
    expect(opts.description).toBe(expectedLink)
  })
})
