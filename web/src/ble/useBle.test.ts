import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectBoard, disconnectBoard, useBle } from './useBle'
import { fakeStack, resetLabStores } from '../test/fakeBleStack'

// connectBoard's failure record (plan R19): the readable text for the shared state and
// the raw rejection for the lab toast. Drives the module-level client singleton, so
// every test disconnects it afterwards.

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  resetLabStores()
})

afterEach(() => {
  act(() => disconnectBoard())
  delete (navigator as unknown as { bluetooth?: unknown }).bluetooth
  vi.restoreAllMocks()
})

describe('connectBoard', () => {
  it('resolves null on success and leaves no error in the shared state', async () => {
    fakeStack(undefined, { minimal: true })
    const { result } = renderHook(() => useBle())
    let outcome: unknown = 'unset'
    await act(async () => {
      outcome = await connectBoard()
    })
    expect(outcome).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.state).toBe('connected')
  })

  it('resolves the fallback message and the raw code for a bare numeric rejection', async () => {
    const stack = fakeStack(undefined, { minimal: true })
    stack.requestDevice.mockRejectedValueOnce(2)
    const { result } = renderHook(() => useBle())
    let failure: Awaited<ReturnType<typeof connectBoard>> = null
    await act(async () => {
      failure = await connectBoard()
    })
    expect(failure).toEqual({
      message: expect.stringContaining("Couldn't reach the board"),
      raw: '2',
    })
    expect(result.current.error).toBe(failure!.message)
  })

  it("resolves an Error's message as both the text and the raw value", async () => {
    const stack = fakeStack(undefined, { minimal: true })
    stack.requestDevice.mockRejectedValueOnce(new Error('adapter off'))
    const failure = await connectBoard()
    expect(failure).toEqual({ message: 'adapter off', raw: 'adapter off' })
  })

  it('keeps a DOMException message as the raw value too', async () => {
    const stack = fakeStack(undefined, { minimal: true })
    stack.requestDevice.mockRejectedValueOnce(
      new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'),
    )
    const failure = await connectBoard()
    expect(failure?.raw).toBe('User cancelled the requestDevice() chooser.')
    expect(failure?.message).toBe('User cancelled the requestDevice() chooser.')
  })
})
