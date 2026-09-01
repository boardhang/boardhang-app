import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHistoryBackClose } from './useHistoryBackClose'

// history.back() is mocked throughout: jsdom's real traversal is async and would fire
// stray popstates into later tests. Every test unmounts explicitly while the mock is
// still installed so no cleanup ever reaches the real back().
let back: MockInstance
beforeEach(() => {
  back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '')
})

describe('useHistoryBackClose', () => {
  it('pushes a keyed history entry when opened, none while closed', () => {
    const { rerender, unmount } = renderHook(
      ({ open }) => useHistoryBackClose(open, vi.fn(), 'testSheet'),
      { initialProps: { open: false } },
    )
    expect(window.history.state?.testSheet).toBeUndefined()
    act(() => {
      // e.g. the router's own entry state — a sheet's push must carry it forward, not replace it.
      window.history.replaceState({ __TSR_index: 3 }, '')
    })
    rerender({ open: true })
    expect(window.history.state?.testSheet).toBe(true)
    expect(window.history.state?.__TSR_index).toBe(3)
    unmount()
  })

  it('closes on popstate (the back gesture)', () => {
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useHistoryBackClose(true, onClose, 'testSheet'))
    act(() => {
      // jsdom's history traversal is async; replace+dispatch models the browser's pop.
      window.history.replaceState({}, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('ignores a popstate that still carries its key (a sheet stacked above it closed)', () => {
    const onClose = vi.fn()
    const { unmount } = renderHook(() => useHistoryBackClose(true, onClose, 'testSheet'))
    act(() => {
      // e.g. the player's entry above this grid popped: the grid's own entry is the
      // new top of the stack, so the grid must stay open.
      window.history.replaceState({ testSheet: true }, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('pops its own entry when closed via UI, keeping history clean', () => {
    const { rerender, unmount } = renderHook(
      ({ open }) => useHistoryBackClose(open, vi.fn(), 'testSheet'),
      { initialProps: { open: true } },
    )
    expect(window.history.state?.testSheet).toBe(true)
    rerender({ open: false })
    expect(back).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does not pop on unmount when the entry is already gone (back-gesture close)', () => {
    const { unmount } = renderHook(() => useHistoryBackClose(true, vi.fn(), 'testSheet'))
    // The back gesture already consumed the entry before the sheet unmounts.
    window.history.replaceState({}, '')
    unmount()
    expect(back).not.toHaveBeenCalled()
  })

  it('always reads the latest onClose without re-running the effect', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ fn }) => useHistoryBackClose(true, fn, 'testSheet'),
      { initialProps: { fn: first } },
    )
    rerender({ fn: second })
    act(() => {
      window.history.replaceState({}, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
  })
})
