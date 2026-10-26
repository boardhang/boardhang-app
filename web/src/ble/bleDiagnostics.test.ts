import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BLE_DIAG_CAP,
  BLE_DIAG_KEY,
  clearBleDiagnostics,
  describeRejection,
  formatBleDiagnostics,
  getBleDiagnostics,
  recordBleEvent,
  resetBleDiagnostics,
  setBleDiagnosticsPersistence,
  setBleLinkSummary,
  updateBleLinkSummary,
  useBleDiagnostics,
  type BleLinkSummary,
} from './bleDiagnostics'

const labOff = { enabled: false, chooser: 'nordic', writeMode: 'auto' } as const

const sampleLink: BleLinkSummary = {
  deviceName: 'MoonBoard A',
  controller: 'redbearlab',
  writeMode: 'with-response',
  forced: false,
  writer: 'split',
  properties: { write: true, writeWithoutResponse: false, notify: false, present: true },
  writers: ['with', 'without'],
  lastAction: null,
}

beforeEach(() => {
  localStorage.clear()
  resetBleDiagnostics()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bleDiagnostics ring buffer', () => {
  it('starts empty with no link', () => {
    expect(getBleDiagnostics()).toEqual({ events: [], link: null })
  })

  it('keeps only the newest events once the cap is exceeded, oldest first', () => {
    for (let i = 0; i < BLE_DIAG_CAP + 20; i++) recordBleEvent('tick', i)
    const { events } = getBleDiagnostics()
    expect(events).toHaveLength(BLE_DIAG_CAP)
    expect(events[0]!.detail).toBe('20')
    expect(events[events.length - 1]!.detail).toBe(String(BLE_DIAG_CAP + 19))
  })

  it('records a timestamp and stringifies primitive and object details', () => {
    const before = Date.now()
    recordBleEvent('connect', { chooser: 'both' })
    recordBleEvent('plain')
    const [a, b] = getBleDiagnostics().events
    expect(a!.t).toBeGreaterThanOrEqual(before)
    expect(a!.kind).toBe('connect')
    expect(a!.detail).toBe('{"chooser":"both"}')
    expect(b!.detail).toBeUndefined()
  })

  it('does not throw on a circular detail and records a placeholder', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => recordBleEvent('weird', circular)).not.toThrow()
    expect(getBleDiagnostics().events[0]!.detail).toMatch(/unserializable/i)
  })

  it('returns the same snapshot between writes and a new one after a write', () => {
    const first = getBleDiagnostics()
    expect(getBleDiagnostics()).toBe(first)
    recordBleEvent('x')
    expect(getBleDiagnostics()).not.toBe(first)
  })
})

describe('bleDiagnostics link summary', () => {
  it('sets, patches, and clears the link summary', () => {
    setBleLinkSummary(sampleLink)
    expect(getBleDiagnostics().link).toEqual(sampleLink)
    updateBleLinkSummary({ lastAction: 'Light LED 0 sent, 1 chunk, with-response' })
    expect(getBleDiagnostics().link?.lastAction).toMatch(/Light LED 0/)
    expect(getBleDiagnostics().link?.controller).toBe('redbearlab')
    setBleLinkSummary(null)
    expect(getBleDiagnostics().link).toBeNull()
  })

  it('ignores a patch when there is no link', () => {
    updateBleLinkSummary({ lastAction: 'nothing' })
    expect(getBleDiagnostics().link).toBeNull()
  })
})

describe('bleDiagnostics persistence', () => {
  it('writes nothing while persistence is off', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    recordBleEvent('a')
    recordBleEvent('b')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(BLE_DIAG_KEY)).toBeNull()
  })

  it('mirrors events to the key while on and restores them after a reset', () => {
    setBleDiagnosticsPersistence(true)
    recordBleEvent('a', 1)
    recordBleEvent('b', 2)
    expect(JSON.parse(localStorage.getItem(BLE_DIAG_KEY)!)).toHaveLength(2)

    resetBleDiagnostics() // simulates a page reload: memory gone, key intact
    expect(getBleDiagnostics().events).toEqual([])
    setBleDiagnosticsPersistence(true)
    expect(getBleDiagnostics().events.map((e) => e.kind)).toEqual(['a', 'b'])
  })

  it('keeps events recorded while off when persistence turns on, and writes them to the key', () => {
    localStorage.setItem(BLE_DIAG_KEY, JSON.stringify([{ t: 1, kind: 'stale' }]))
    recordBleEvent('control-1')
    recordBleEvent('control-2')
    recordBleEvent('control-3')
    setBleDiagnosticsPersistence(true)
    expect(getBleDiagnostics().events.map((e) => e.kind)).toEqual([
      'control-1',
      'control-2',
      'control-3',
    ])
    const stored = JSON.parse(localStorage.getItem(BLE_DIAG_KEY)!) as { kind: string }[]
    expect(stored.map((e) => e.kind)).toEqual(['control-1', 'control-2', 'control-3'])
  })

  it('drops malformed stored entries on load', () => {
    localStorage.setItem(
      BLE_DIAG_KEY,
      JSON.stringify([{ t: 5, kind: 'ok' }, { nope: true }, 'junk', { t: 'x', kind: 'bad-t' }]),
    )
    setBleDiagnosticsPersistence(true)
    expect(getBleDiagnostics().events).toEqual([{ t: 5, kind: 'ok' }])
  })

  it('starts empty when storage throws on read, and keeps recording when it throws on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    setBleDiagnosticsPersistence(true)
    expect(getBleDiagnostics().events).toEqual([])
    expect(() => recordBleEvent('still-works')).not.toThrow()
    expect(getBleDiagnostics().events.map((e) => e.kind)).toEqual(['still-works'])
  })

  it('stops writing after persistence turns off but keeps memory', () => {
    setBleDiagnosticsPersistence(true)
    recordBleEvent('a')
    setBleDiagnosticsPersistence(false)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    recordBleEvent('b')
    expect(setItem).not.toHaveBeenCalled()
    expect(getBleDiagnostics().events.map((e) => e.kind)).toEqual(['a', 'b'])
  })

  it('clear empties events and link, removes the key while on, and notifies', () => {
    setBleDiagnosticsPersistence(true)
    recordBleEvent('a')
    setBleLinkSummary(sampleLink)
    const listener = vi.fn()
    const { result } = renderHook(() => useBleDiagnostics())
    act(() => clearBleDiagnostics())
    expect(getBleDiagnostics()).toEqual({ events: [], link: null })
    expect(localStorage.getItem(BLE_DIAG_KEY)).toBeNull()
    expect(result.current.events).toEqual([])
    listener.mockReset()
  })
})

describe('describeRejection', () => {
  it('names the type and value of a bare primitive', () => {
    const text = describeRejection(2)
    expect(text).toContain('number')
    expect(text).toContain('2')
  })

  it('names a DOMException by name and message', () => {
    const text = describeRejection(new DOMException('No Services matching UUID found.', 'NotFoundError'))
    expect(text).toContain('NotFoundError')
    expect(text).toContain('No Services matching UUID found.')
  })

  it('passes a plain string through', () => {
    expect(describeRejection('cancelled')).toContain('cancelled')
  })

  it('reports an Error with its name and message', () => {
    expect(describeRejection(new Error('adapter off'))).toMatch(/Error.*adapter off/)
  })
})

describe('formatBleDiagnostics', () => {
  it('lists the settings, the link summary, and the events oldest first with ISO timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_001_000)
    recordBleEvent('first', 'one')
    recordBleEvent('second', 'two')
    setBleLinkSummary(sampleLink)
    const text = formatBleDiagnostics({ enabled: true, chooser: 'both', writeMode: 'auto' })
    expect(text).toContain('enabled=true')
    expect(text).toContain('chooser=both')
    expect(text).toContain('controller=redbearlab')
    expect(text).toContain('writeMode=with-response')
    const firstAt = text.indexOf('first one')
    const secondAt = text.indexOf('second two')
    expect(firstAt).toBeGreaterThan(-1)
    expect(secondAt).toBeGreaterThan(firstAt)
    expect(text).toContain('2023-11-14T22:13:20.000Z first one')
  })

  it('says there is no link and no events when empty', () => {
    const text = formatBleDiagnostics(labOff)
    expect(text).toMatch(/Link: none/)
    expect(text).toMatch(/Events \(0/)
  })
})

describe('useBleDiagnostics', () => {
  it('re-renders on record and on clear', () => {
    const { result } = renderHook(() => useBleDiagnostics())
    expect(result.current.events).toEqual([])
    act(() => recordBleEvent('hello'))
    expect(result.current.events.map((e) => e.kind)).toEqual(['hello'])
    act(() => clearBleDiagnostics())
    expect(result.current.events).toEqual([])
  })
})
