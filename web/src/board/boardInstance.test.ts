import { describe, expect, it } from 'vitest'
import { boardByLayoutId } from './boards'
import {
  canSetAngle,
  canSetHoldSets,
  instanceName,
  layoutIdFromInstanceId,
  localInstanceId,
  parseSharedBoardMirror,
  resolveInstanceAngle,
  sharedInstanceId,
  type BoardInstance,
  type SharedBoardMirror,
} from './boardInstance'

const mini = boardByLayoutId(7)! // angles [40] — single-angle, implicitly fixed
const masters = boardByLayoutId(5)! // angles [40, 25]

const mirror = (over: Partial<SharedBoardMirror> = {}): SharedBoardMirror => ({
  boardId: 'b1',
  role: 'member',
  name: 'Gym wall',
  layoutId: 5,
  angleMode: 'fixed',
  canonicalAngle: 25,
  canonicalHoldSetsRaw: '17|18',
  ...over,
})

const local = (layout = masters): BoardInstance => ({
  instanceId: localInstanceId(layout.layoutId),
  layoutId: layout.layoutId,
  layout,
})

const shared = (over: Partial<SharedBoardMirror> = {}, layout = masters): BoardInstance => {
  const m = mirror(over)
  return {
    instanceId: sharedInstanceId(m.boardId),
    layoutId: layout.layoutId,
    layout,
    shared: m,
  }
}

describe('instance ids', () => {
  it('gives a local instance the bare layout id, so pre-instance keys keep working', () => {
    expect(localInstanceId(7)).toBe('7')
    expect(layoutIdFromInstanceId('7')).toBe(7)
  })

  it('namespaces an adopted instance and carries no layout in the id itself', () => {
    expect(sharedInstanceId('abc-123')).toBe('S:abc-123')
    // The layout comes from the mirror, not the id — an S: id must not be mistaken
    // for a layout id (Number('S:5') is NaN, but be explicit about the contract).
    expect(layoutIdFromInstanceId('S:abc-123')).toBeUndefined()
  })

  it('rejects non-integer bare ids rather than coercing them', () => {
    expect(layoutIdFromInstanceId('')).toBeUndefined()
    expect(layoutIdFromInstanceId('7.5')).toBeUndefined()
    expect(layoutIdFromInstanceId('nope')).toBeUndefined()
  })
})

describe('shared-ness is read from the mirror, not the id shape (KTD1)', () => {
  it('treats a bare-id instance holding a mirror as shared — the promoted case', () => {
    const promoted: BoardInstance = { ...local(), shared: mirror({ role: 'owner' }) }
    expect(promoted.instanceId).toBe('5') // id was never re-keyed on promote
    expect(canSetHoldSets(promoted)).toBe(true) // owner
    expect(instanceName(promoted)).toBe('Gym wall')
  })

  it('treats an S:-id instance with no mirror as local — the demoted case', () => {
    const demoted: BoardInstance = {
      instanceId: 'S:b1',
      layoutId: masters.layoutId,
      layout: masters,
    }
    expect(canSetAngle(demoted)).toBe(true)
    expect(canSetHoldSets(demoted)).toBe(true)
    expect(instanceName(demoted)).toBe(masters.name) // falls back to the layout name
  })
})

describe('write permissions (KTD4)', () => {
  it('lets a local instance set both angle and hold sets', () => {
    expect(canSetAngle(local())).toBe(true)
    expect(canSetHoldSets(local())).toBe(true)
  })

  it('refuses a member of a fixed wall the angle, and every member the hold sets', () => {
    const fixedMember = shared({ role: 'member', angleMode: 'fixed' })
    expect(canSetAngle(fixedMember)).toBe(false)
    expect(canSetHoldSets(fixedMember)).toBe(false)
  })

  it('lets a member of an adjustable wall set the angle but not the hold sets', () => {
    const adjustableMember = shared({ role: 'member', angleMode: 'adjustable' })
    expect(canSetAngle(adjustableMember)).toBe(true)
    expect(canSetHoldSets(adjustableMember)).toBe(false)
  })

  it('lets the owner set both, on a fixed wall too — it is their wall to re-declare', () => {
    const owner = shared({ role: 'owner', angleMode: 'fixed' })
    expect(canSetAngle(owner)).toBe(true)
    expect(canSetHoldSets(owner)).toBe(true)
  })
})

describe('mirror parsing (KTD2)', () => {
  it('round-trips a well-formed mirror', () => {
    const m = mirror()
    expect(parseSharedBoardMirror(JSON.stringify(m))).toEqual(m)
  })

  it('returns undefined for a missing, non-JSON, or non-object value', () => {
    expect(parseSharedBoardMirror(null)).toBeUndefined()
    expect(parseSharedBoardMirror('')).toBeUndefined()
    expect(parseSharedBoardMirror('{ half-written')).toBeUndefined()
    expect(parseSharedBoardMirror('"a string"')).toBeUndefined()
    expect(parseSharedBoardMirror('null')).toBeUndefined()
    expect(parseSharedBoardMirror('[]')).toBeUndefined()
  })

  it('rejects a structurally wrong mirror field by field', () => {
    const bad = (over: Record<string, unknown>) =>
      parseSharedBoardMirror(JSON.stringify({ ...mirror(), ...over }))
    expect(bad({ boardId: '' })).toBeUndefined()
    expect(bad({ boardId: 42 })).toBeUndefined()
    expect(bad({ role: 'admin' })).toBeUndefined()
    expect(bad({ layoutId: 'five' })).toBeUndefined()
    expect(bad({ layoutId: 5.5 })).toBeUndefined()
    expect(bad({ angleMode: 'motorized' })).toBeUndefined()
    expect(bad({ canonicalAngle: 'steep' })).toBeUndefined()
    expect(bad({ canonicalHoldSetsRaw: null })).toBeUndefined()
  })

  it('accepts an empty hold-set string — empty means "filter off", not "none installed"', () => {
    expect(parseSharedBoardMirror(JSON.stringify(mirror({ canonicalHoldSetsRaw: '' })))?.
      canonicalHoldSetsRaw).toBe('')
  })
})

describe('angle resolution (KTD3)', () => {
  it('honors a stored angle the layout bundles, on a local instance', () => {
    expect(resolveInstanceAngle(local(), '25')).toBe(25)
  })

  it('falls back to the layout default when unset or not bundled', () => {
    expect(resolveInstanceAngle(local(), null)).toBe(40)
    expect(resolveInstanceAngle(local(), '30')).toBe(40)
    expect(resolveInstanceAngle(local(), 'garbage')).toBe(40)
    expect(resolveInstanceAngle(local(mini), '25')).toBe(40) // Mini bundles only 40
  })

  it('overrides a stale stored angle with canonical on a fixed shared wall (R8b)', () => {
    const fixed = shared({ angleMode: 'fixed', canonicalAngle: 25 })
    expect(resolveInstanceAngle(fixed, '40')).toBe(25)
    expect(resolveInstanceAngle(fixed, null)).toBe(25)
  })

  it('clamps an out-of-registry canonical angle to the layout default, not to canonical', () => {
    // A bad row must not reach the slab loader's (layoutId, angle) key and hand every
    // member an unresolvable catalog.
    const fixed = shared({ angleMode: 'fixed', canonicalAngle: 33 })
    expect(resolveInstanceAngle(fixed, '25')).toBe(40)
  })

  it('honors the stored angle on an adjustable shared wall (R8a)', () => {
    const adjustable = shared({ angleMode: 'adjustable', canonicalAngle: 40 })
    expect(resolveInstanceAngle(adjustable, '25')).toBe(25)
    // ...and still clamps a value the layout does not bundle.
    expect(resolveInstanceAngle(adjustable, '33')).toBe(40)
  })
})
