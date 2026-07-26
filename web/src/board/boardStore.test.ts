import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SharedBoardMirror } from './boardInstance'
import {
  activateBoard,
  addBoard,
  addSharedInstance,
  demoteInstanceToLocal,
  getActiveHoldSetsRaw,
  getActiveInstanceId,
  getAddedInstanceIds,
  getAngle,
  getFlipped,
  instanceById,
  instanceByLayoutId,
  removeBoard,
  setActiveHoldSetsRaw,
  setAngle,
  setFlipped,
  syncBoardsIdentity,
  updateInstanceMirror,
  useBoardStore,
} from './boardStore'

/** The instance a plain `addBoard(layoutId)` produces. */
const inst = (layoutId: number) => instanceByLayoutId(layoutId)!

const mirror = (over: Partial<SharedBoardMirror> = {}): SharedBoardMirror => ({
  boardId: 'board-uuid-1',
  role: 'member',
  name: 'Gym wall',
  layoutId: 5,
  angleMode: 'fixed',
  canonicalAngle: 25,
  canonicalHoldSetsRaw: '17|18',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  // Force the module-level snapshot to recompute from the cleared store, via the
  // same 'storage' listener that keeps tabs in sync — avoids cross-test bleed.
  window.dispatchEvent(new StorageEvent('storage'))
})

describe('added boards', () => {
  it('starts empty and records added boards, re-fronting on re-add', () => {
    expect(getAddedInstanceIds()).toEqual([])
    addBoard(7)
    addBoard(5)
    expect(getAddedInstanceIds()).toEqual(['5', '7']) // most-recent first
    addBoard(7) // re-adding re-fronts (no duplicate)
    expect(getAddedInstanceIds()).toEqual(['7', '5'])
  })

  it('ignores unsupported layout ids', () => {
    addBoard(1) // MoonBoard 2010 — not a catalog board
    expect(getAddedInstanceIds()).toEqual([])
  })

  it('activating promotes the instance to the front (MRU) and sets it active', () => {
    addBoard(7)
    addBoard(5)
    addBoard(3)
    activateBoard('5')
    expect(getAddedInstanceIds()).toEqual(['5', '3', '7'])
    expect(getActiveInstanceId()).toBe('5')
  })

  it('removing drops the instance from the list', () => {
    addBoard(7)
    addBoard(5)
    removeBoard('7')
    expect(getAddedInstanceIds()).toEqual(['5'])
  })

  it('removing the active instance reassigns active to the new MRU front', () => {
    addBoard(5)
    addBoard(7)
    activateBoard('7') // list [7, 5], active 7
    removeBoard('7')
    expect(getAddedInstanceIds()).toEqual(['5'])
    expect(getActiveInstanceId()).toBe('5')
  })

  it('removing the last active instance falls back to the default', () => {
    addBoard(3)
    activateBoard('3')
    removeBoard('3')
    expect(getAddedInstanceIds()).toEqual([])
    expect(getActiveInstanceId()).toBe('7') // DEFAULT_ACTIVE
  })
})

describe('active board', () => {
  it('defaults to Mini 2025 when unset', () => {
    expect(getActiveInstanceId()).toBe('7')
  })

  it('adopts the just-added board as active when the stored active is not held', () => {
    // Fresh install: stored active defaults to Mini 2025 (7), which isn't held.
    // Adding the first board must make it the active one so the list has a Browse.
    expect(getActiveInstanceId()).toBe('7')
    addBoard(5)
    expect(getActiveInstanceId()).toBe('5')
    // A second add does NOT steal active — the held active instance stays put.
    addBoard(7)
    expect(getActiveInstanceId()).toBe('5')
  })

  it('surfaces the held MRU front when stored active dangles to an unheld board', () => {
    // Legacy state predating the held-active invariant: an added board plus a stored
    // active id that was never added. The snapshot must show a held instance (id 5), so
    // exactly one Browse renders — even though the raw stored id still reads 7.
    localStorage.setItem('addedBoards', '5')
    localStorage.setItem('activeBoardId', '7')
    window.dispatchEvent(new StorageEvent('storage'))
    const { result } = renderHook(() => useBoardStore())
    expect(result.current.activeInstance.layoutId).toBe(5)
  })

  it('yields the zero-instance state for an empty list', () => {
    localStorage.setItem('addedBoards', '')
    window.dispatchEvent(new StorageEvent('storage'))
    const { result } = renderHook(() => useBoardStore())
    expect(result.current.instances).toEqual([])
  })
})

describe('legacy state migrates with no writes', () => {
  it('reads bare layout ids as local instances, preserving every per-board value', () => {
    localStorage.setItem('addedBoards', '7|5')
    localStorage.setItem('activeBoardId', '7')
    localStorage.setItem('angle_5', '25')
    localStorage.setItem('activeHoldSets_5', '17|18')
    localStorage.setItem('flipped_5', 'true')
    window.dispatchEvent(new StorageEvent('storage'))

    const { result } = renderHook(() => useBoardStore())
    expect(result.current.instances.map((i) => i.instanceId)).toEqual(['7', '5'])
    expect(result.current.instances.every((i) => i.shared === undefined)).toBe(true)
    expect(getAngle(inst(5))).toBe(25)
    expect(getActiveHoldSetsRaw(inst(5))).toBe('17|18')
    expect(getFlipped('5')).toBe(true)
    // ...and the raw values are untouched: reading is a pure reinterpretation.
    expect(localStorage.getItem('addedBoards')).toBe('7|5')
    expect(localStorage.getItem('angle_5')).toBe('25')
    expect(localStorage.getItem('activeHoldSets_5')).toBe('17|18')
  })

  it('skips an added id whose layout is not in the registry', () => {
    localStorage.setItem('addedBoards', '7|999')
    window.dispatchEvent(new StorageEvent('storage'))
    expect(getAddedInstanceIds()).toEqual(['7'])
  })
})

describe('shared instances coexist with local ones (AE2)', () => {
  it('adding a shared instance leaves a local instance of the same layout byte-identical', () => {
    addBoard(5)
    setAngle(inst(5), 25)
    setActiveHoldSetsRaw(inst(5), '17|18')
    setFlipped('5', true)
    const before = {
      angle: localStorage.getItem('angle_5'),
      holds: localStorage.getItem('activeHoldSets_5'),
      flipped: localStorage.getItem('flipped_5'),
    }

    const id = addSharedInstance(mirror({ canonicalAngle: 40, canonicalHoldSetsRaw: '19' }))!
    expect(id).toBe('S:board-uuid-1')
    expect(getAddedInstanceIds()).toEqual(['S:board-uuid-1', '5'])

    expect(localStorage.getItem('angle_5')).toBe(before.angle)
    expect(localStorage.getItem('activeHoldSets_5')).toBe(before.holds)
    expect(localStorage.getItem('flipped_5')).toBe(before.flipped)
    // The two instances resolve independently.
    expect(getAngle(inst(5))).toBe(25)
    expect(getAngle(instanceById(id)!)).toBe(40)
  })

  it('refuses to adopt a board whose layout is not in the registry', () => {
    expect(addSharedInstance(mirror({ layoutId: 999 }))).toBeUndefined()
    expect(getAddedInstanceIds()).toEqual([])
  })

  it('removing one instance leaves its same-layout sibling untouched', () => {
    addBoard(5)
    setAngle(inst(5), 25)
    const id = addSharedInstance(mirror())!
    removeBoard(id)
    expect(getAddedInstanceIds()).toEqual(['5'])
    expect(getAngle(inst(5))).toBe(25)
  })
})

describe('instance ids are never re-keyed (KTD1)', () => {
  it('promoting a local instance keeps its bare id and all three per-instance keys', () => {
    addBoard(5)
    setAngle(inst(5), 25)
    setActiveHoldSetsRaw(inst(5), '17|18')
    setFlipped('5', true)

    // Promotion = writing a mirror against the *existing* id, not minting a new one.
    localStorage.setItem(
      'sharedBoard__5',
      JSON.stringify(mirror({ role: 'owner', angleMode: 'adjustable' })),
    )
    window.dispatchEvent(new StorageEvent('storage'))

    expect(getAddedInstanceIds()).toEqual(['5'])
    expect(instanceById('5')!.shared?.role).toBe('owner')
    expect(localStorage.getItem('angle_5')).toBe('25')
    expect(localStorage.getItem('activeHoldSets_5')).toBe('17|18')
    expect(localStorage.getItem('flipped_5')).toBe('true')
  })

  it('demoting keeps the S: id, clears sharing, keeps values, and re-enables writes', () => {
    // A member who also holds a local instance of the same layout — the collision case
    // re-keying on demote would cause (AE5).
    addBoard(5)
    setAngle(inst(5), 40)
    const id = addSharedInstance(mirror({ angleMode: 'fixed', canonicalAngle: 25 }))!

    demoteInstanceToLocal(id)

    expect(getAddedInstanceIds()).toEqual([id, '5']) // id unchanged, no collision
    expect(instanceById(id)!.shared).toBeUndefined()
    // The canonical values it was browsing at are frozen in, not snapped to defaults.
    expect(getAngle(instanceById(id)!)).toBe(25)
    expect(getActiveHoldSetsRaw(instanceById(id)!)).toBe('17|18')
    // Both writes work again.
    setAngle(instanceById(id)!, 40)
    expect(getAngle(instanceById(id)!)).toBe(40)
    setActiveHoldSetsRaw(instanceById(id)!, '19')
    expect(getActiveHoldSetsRaw(instanceById(id)!)).toBe('19')
    // The sibling local instance is untouched.
    expect(getAngle(inst(5))).toBe(40)
  })

  it('a demoted instance survives a reload, while a mirror-less one never adopted does not', () => {
    // These two states differ only by the layout pin, and that is the whole point: both
    // are an `S:` id with no mirror, but one is a deliberate demote and the other is a
    // half-written adoption that must stay dropped.
    const id = addSharedInstance(mirror())!
    demoteInstanceToLocal(id)
    window.dispatchEvent(new StorageEvent('storage')) // reload: rebuild purely from storage
    expect(getAddedInstanceIds()).toEqual([id])
    expect(instanceById(id)!.layoutId).toBe(5)

    localStorage.removeItem('instanceLayout_' + id)
    window.dispatchEvent(new StorageEvent('storage'))
    expect(getAddedInstanceIds()).toEqual([])
  })

  it('demoting a purely local instance is a no-op', () => {
    addBoard(5)
    demoteInstanceToLocal('5')
    expect(instanceById('5')!.shared).toBeUndefined()
  })
})

describe('orphaned shared instances (KTD2)', () => {
  it('drops an S: instance with no mirror from the snapshot without writing', () => {
    localStorage.setItem('addedBoards', '7|S:board-uuid-1')
    window.dispatchEvent(new StorageEvent('storage'))

    const { result } = renderHook(() => useBoardStore())
    expect(result.current.instances.map((i) => i.instanceId)).toEqual(['7'])
    // The stored list is deliberately NOT rewritten — a transient read failure must not
    // destroy state that becomes valid again once the mirror lands.
    expect(localStorage.getItem('addedBoards')).toBe('7|S:board-uuid-1')
  })

  it('drops an S: instance whose mirror is unparseable', () => {
    localStorage.setItem('addedBoards', 'S:board-uuid-1')
    localStorage.setItem('sharedBoard__S:board-uuid-1', '{ half-written')
    window.dispatchEvent(new StorageEvent('storage'))
    expect(getAddedInstanceIds()).toEqual([])
  })

  it('refuses to update a mirror that does not exist', () => {
    updateInstanceMirror('S:nope', mirror())
    expect(localStorage.getItem('sharedBoard__S:nope')).toBeNull()
  })
})

describe('write guards (KTD4)', () => {
  it('refuses setAngle on a fixed member instance and honors it on an adjustable one', () => {
    const fixed = instanceById(addSharedInstance(mirror({ angleMode: 'fixed', canonicalAngle: 25 }))!)!
    setAngle(fixed, 40)
    expect(getAngle(fixed)).toBe(25) // canonical still wins
    expect(localStorage.getItem('angle_S:board-uuid-1')).toBeNull() // nothing was written

    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage'))
    const adjustable = instanceById(
      addSharedInstance(mirror({ angleMode: 'adjustable', canonicalAngle: 40 }))!,
    )!
    setAngle(adjustable, 25)
    expect(getAngle(instanceById(adjustable.instanceId)!)).toBe(25)
  })

  it('refuses setActiveHoldSetsRaw on any member instance', () => {
    const member = instanceById(addSharedInstance(mirror({ angleMode: 'adjustable' }))!)!
    setActiveHoldSetsRaw(member, '19')
    // The owner's canonical set is what a member reads, and the write left no trace.
    expect(getActiveHoldSetsRaw(member)).toBe('17|18')
    expect(localStorage.getItem('activeHoldSets_S:board-uuid-1')).toBeNull()
  })

  it('lets an owner set both on their own shared instance', () => {
    const id = addSharedInstance(mirror({ role: 'owner', angleMode: 'fixed', canonicalAngle: 40 }))!
    setAngle(instanceById(id)!, 25)
    setActiveHoldSetsRaw(instanceById(id)!, '19')
    expect(getActiveHoldSetsRaw(instanceById(id)!)).toBe('19')
  })
})

describe('per-instance settings persist and survive reload', () => {
  it('angle: stored per instance, falls back to default, ignores invalid-for-board', () => {
    addBoard(5)
    addBoard(7)
    expect(getAngle(inst(5))).toBe(40) // default = first angle
    setAngle(inst(5), 25)
    expect(getAngle(inst(5))).toBe(25) // re-read from localStorage == survives reload
    setAngle(inst(7), 25) // 25 not offered by Mini
    expect(getAngle(inst(7))).toBe(40) // clamped to default
  })

  it('flipped: defaults false, persists per instance', () => {
    expect(getFlipped('5')).toBe(false)
    setFlipped('5', true)
    expect(getFlipped('5')).toBe(true)
    expect(getFlipped('7')).toBe(false) // independent per instance
  })

  it('flipped is independent for two instances of one layout — it is the holder’s wiring', () => {
    addBoard(5)
    const id = addSharedInstance(mirror())!
    setFlipped('5', true)
    expect(getFlipped(id)).toBe(false)
  })

  it('installed hold sets: defaults empty, persists the raw string', () => {
    addBoard(5)
    expect(getActiveHoldSetsRaw(inst(5))).toBe('')
    setActiveHoldSetsRaw(inst(5), '17|18')
    expect(getActiveHoldSetsRaw(inst(5))).toBe('17|18')
  })

  it('empty activeHoldSets still means "filter off", not "no hold sets installed"', () => {
    addBoard(5)
    setActiveHoldSetsRaw(inst(5), '')
    expect(getActiveHoldSetsRaw(inst(5))).toBe('')
  })
})

describe('account scoping (KTD14)', () => {
  it('keeps a shared instance across sign-out — it must survive the owner disappearing', () => {
    syncBoardsIdentity('user-a')
    const id = addSharedInstance(mirror())!
    syncBoardsIdentity(null) // sign out
    expect(getAddedInstanceIds()).toContain(id)
    expect(instanceById(id)!.shared?.name).toBe('Gym wall')
  })

  it('keeps it when the same account signs back in', () => {
    syncBoardsIdentity('user-a')
    const id = addSharedInstance(mirror())!
    syncBoardsIdentity(null)
    syncBoardsIdentity('user-a')
    expect(getAddedInstanceIds()).toContain(id)
  })

  it('drops the previous account’s shared instances when a different account signs in', () => {
    syncBoardsIdentity('user-a')
    addBoard(7) // a purely local instance
    const id = addSharedInstance(mirror())!

    syncBoardsIdentity('user-b')

    expect(getAddedInstanceIds()).toEqual(['7']) // local survives, shared does not
    expect(localStorage.getItem('sharedBoard_user-a_' + id)).toBeNull()
    expect(localStorage.getItem('angle_' + id)).toBeNull()
  })

  it('reassigns the active instance when the account switch removed it', () => {
    syncBoardsIdentity('user-a')
    addBoard(7)
    addSharedInstance(mirror()) // becomes active
    syncBoardsIdentity('user-b')
    expect(getActiveInstanceId()).toBe('7')
  })
})

describe('useBoardStore hook', () => {
  it('re-renders when actions mutate the store', () => {
    const { result } = renderHook(() => useBoardStore())
    expect(result.current.instances).toEqual([])

    act(() => result.current.addBoard(5))
    expect(result.current.instances.map((i) => i.layoutId)).toEqual([5])

    act(() => result.current.addBoard(7))
    act(() => result.current.activateBoard('7'))
    expect(result.current.activeInstance.layoutId).toBe(7)
    expect(result.current.instances.map((i) => i.layoutId)).toEqual([7, 5])
  })
})
