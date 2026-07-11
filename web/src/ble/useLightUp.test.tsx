import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { boardByLayoutId } from '../board/boards'
import { useLightUp } from './useLightUp'
import * as ble from './useBle'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('./useBle', () => ({
  useBle: vi.fn(() => ({ state: 'disconnected', deviceName: null, error: null })),
  connectBoard: vi.fn(),
  isConnected: vi.fn(() => false),
  setBleError: vi.fn(),
  bleClient: { send: vi.fn(), state: 'disconnected' },
}))

const board = boardByLayoutId(7)!
const holds = [{ c: 0, r: 1, t: 'start' as const }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ble.useBle).mockReturnValue({ state: 'disconnected', deviceName: null, error: null })
  vi.mocked(ble.isConnected).mockReturnValue(false)
})

describe('useLightUp', () => {
  it('connects before sending when disconnected, and does not send if connect fails', async () => {
    vi.mocked(ble.isConnected).mockReturnValue(false) // stays disconnected after connect
    const { result } = renderHook(() => useLightUp(board, 'a'))
    await act(async () => {
      await result.current.lightUp(holds)
    })
    expect(ble.connectBoard).toHaveBeenCalled()
    expect(ble.bleClient.send).not.toHaveBeenCalled()
    expect(result.current.lit).toBe(false)
  })

  it('sends the mapped holds when already connected and marks lit', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    const { result } = renderHook(() => useLightUp(board, 'a'))
    await act(async () => {
      await result.current.lightUp(holds)
    })
    expect(ble.bleClient.send).toHaveBeenCalledWith(
      [{ col: 0, row: 1, type: 'start' }],
      expect.objectContaining({ rows: board.geometry.numRows, showBeta: true }),
    )
    await waitFor(() => expect(result.current.lit).toBe(true))
  })

  it('surfaces a send failure as a toast and stays un-lit', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    vi.mocked(ble.bleClient.send).mockRejectedValueOnce(new Error('write failed'))
    const { result } = renderHook(() => useLightUp(board, 'a'))
    await act(async () => {
      await result.current.lightUp(holds)
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('write failed'))
    expect(result.current.lit).toBe(false)
  })

  it('reports an unreadable rejection (a bare code) as a friendly message', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    vi.mocked(ble.bleClient.send).mockRejectedValueOnce(2) // iOS Bluefy: bare numeric code → "2"
    const { result } = renderHook(() => useLightUp(board, 'a'))
    await act(async () => {
      await result.current.lightUp(holds)
    })
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't reach the board")),
    )
    expect(result.current.lit).toBe(false)
  })

  it('drops a send that resolves after the target changed (no stale lit)', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    let resolveSend!: () => void
    vi.mocked(ble.bleClient.send).mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveSend = res
      }),
    )
    const { result, rerender } = renderHook(({ key }) => useLightUp(board, key), {
      initialProps: { key: 'a' },
    })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.lightUp(holds)
    })
    rerender({ key: 'b' }) // user swiped to another problem mid-send
    await act(async () => {
      resolveSend()
      await pending
    })
    expect(result.current.lit).toBe(false)
  })

  it('does not toast a stale send failure after the target changed', async () => {
    vi.mocked(ble.useBle).mockReturnValue({ state: 'connected', deviceName: 'MB', error: null })
    vi.mocked(ble.isConnected).mockReturnValue(true)
    let rejectSend!: () => void
    vi.mocked(ble.bleClient.send).mockReturnValueOnce(
      new Promise<void>((_, rej) => {
        rejectSend = () => rej(new Error('write failed'))
      }),
    )
    const { result, rerender } = renderHook(({ key }) => useLightUp(board, key), {
      initialProps: { key: 'a' },
    })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.lightUp(holds)
    })
    rerender({ key: 'b' })
    await act(async () => {
      rejectSend()
      await pending
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
