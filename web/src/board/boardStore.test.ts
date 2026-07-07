import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { boardByLayoutId } from './boards'
import {
  activateBoard,
  addBoard,
  getActiveBoardId,
  getActiveHoldSetsRaw,
  getAddedBoardIds,
  getAngle,
  getFlipped,
  removeBoard,
  setActiveHoldSetsRaw,
  setAngle,
  setFlipped,
  useBoardStore,
} from './boardStore'

const mini = boardByLayoutId(7)! // angles [40]
const masters = boardByLayoutId(5)! // angles [40, 25]

beforeEach(() => {
  localStorage.clear()
  // Force the module-level snapshot to recompute from the cleared store, via the
  // same 'storage' listener that keeps tabs in sync — avoids cross-test bleed.
  window.dispatchEvent(new StorageEvent('storage'))
})

describe('added boards', () => {
  it('starts empty and records added boards, re-fronting on re-add', () => {
    expect(getAddedBoardIds()).toEqual([])
    addBoard(7)
    addBoard(5)
    expect(getAddedBoardIds()).toEqual([5, 7]) // most-recent first
    addBoard(7) // re-adding re-fronts (no duplicate)
    expect(getAddedBoardIds()).toEqual([7, 5])
  })

  it('ignores unsupported layout ids', () => {
    addBoard(1) // MoonBoard 2010 — not a catalog board
    expect(getAddedBoardIds()).toEqual([])
  })

  it('activating promotes the board to the front (MRU) and sets it active', () => {
    addBoard(7)
    addBoard(5)
    addBoard(3)
    activateBoard(5)
    expect(getAddedBoardIds()).toEqual([5, 3, 7])
    expect(getActiveBoardId()).toBe(5)
  })

  it('removing drops the board from the list', () => {
    addBoard(7)
    addBoard(5)
    removeBoard(7)
    expect(getAddedBoardIds()).toEqual([5])
  })

  it('removing the active board reassigns active to the new MRU front', () => {
    addBoard(5)
    addBoard(7)
    activateBoard(7) // list [7, 5], active 7
    removeBoard(7)
    expect(getAddedBoardIds()).toEqual([5])
    expect(getActiveBoardId()).toBe(5)
  })

  it('removing the last active board falls back to the default', () => {
    addBoard(3)
    activateBoard(3)
    removeBoard(3)
    expect(getAddedBoardIds()).toEqual([])
    expect(getActiveBoardId()).toBe(7) // DEFAULT_ACTIVE
  })
})

describe('active board', () => {
  it('defaults to Mini 2025 when unset', () => {
    expect(getActiveBoardId()).toBe(7)
  })

  it('adopts the just-added board as active when the stored active is not owned', () => {
    // Fresh install: stored active defaults to Mini 2025 (7), which isn't owned.
    // Adding the first board must make it the active one so the list has a Browse.
    expect(getActiveBoardId()).toBe(7)
    addBoard(5)
    expect(getActiveBoardId()).toBe(5)
    // A second add does NOT steal active — the owned active board stays put.
    addBoard(7)
    expect(getActiveBoardId()).toBe(5)
  })

  it('surfaces the owned MRU front when stored active dangles to an un-owned board', () => {
    // Legacy state predating the owned-active invariant: an added board plus a
    // stored active id that was never added. The snapshot must show an owned
    // board (id 5), so exactly one Browse renders — even though the raw stored
    // id (untouched here) still reads 7.
    localStorage.setItem('addedBoards', '5')
    localStorage.setItem('activeBoardId', '7')
    window.dispatchEvent(new StorageEvent('storage'))
    const { result } = renderHook(() => useBoardStore())
    expect(result.current.activeBoard.layoutId).toBe(5)
  })
})

describe('per-board settings persist and survive reload', () => {
  it('angle: stored per board, falls back to default, ignores invalid-for-board', () => {
    expect(getAngle(masters)).toBe(40) // default = first angle
    setAngle(masters.layoutId, 25)
    expect(getAngle(masters)).toBe(25) // re-read from localStorage == survives reload
    setAngle(mini.layoutId, 25) // 25 not offered by Mini
    expect(getAngle(mini)).toBe(40) // clamped to default
  })

  it('flipped: defaults false, persists per board', () => {
    expect(getFlipped(5)).toBe(false)
    setFlipped(5, true)
    expect(getFlipped(5)).toBe(true)
    expect(getFlipped(7)).toBe(false) // independent per board
  })

  it('installed hold sets: defaults empty, persists the raw string', () => {
    expect(getActiveHoldSetsRaw(5)).toBe('')
    setActiveHoldSetsRaw(5, '17|18')
    expect(getActiveHoldSetsRaw(5)).toBe('17|18')
  })
})

describe('useBoardStore hook', () => {
  it('re-renders when actions mutate the store', () => {
    const { result } = renderHook(() => useBoardStore())
    expect(result.current.addedBoards).toEqual([])

    act(() => result.current.addBoard(5))
    expect(result.current.addedBoards.map((b) => b.layoutId)).toEqual([5])

    act(() => result.current.activateBoard(7))
    expect(result.current.activeBoard.layoutId).toBe(7)
    expect(result.current.addedBoards.map((b) => b.layoutId)).toEqual([7, 5])
  })
})
