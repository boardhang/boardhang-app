import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LAB_SETTINGS,
  LAB_SETTINGS_KEY,
  getLabSettings,
  setLabSettings,
  useLabSettings,
} from './labSettings'
import { BLE_DIAG_KEY, getBleDiagnostics, recordBleEvent, resetBleDiagnostics } from './bleDiagnostics'

function resetStores() {
  localStorage.clear()
  // Reset the reactive snapshot (survives localStorage.clear()). Wrapped in act so a
  // still-mounted hook from the previous test re-renders without a warning.
  act(() => window.dispatchEvent(new StorageEvent('storage')))
  act(() => resetBleDiagnostics())
}

beforeEach(resetStores)
afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
})

describe('labSettings', () => {
  it('defaults to the lab off, the Nordic-only picker, and auto write mode', () => {
    expect(getLabSettings()).toEqual({ enabled: false, chooser: 'nordic', writeMode: 'auto' })
    expect(getLabSettings()).toEqual(DEFAULT_LAB_SETTINGS)
  })

  it('persists a patch and reads it back after a storage sync', () => {
    setLabSettings({ enabled: true, chooser: 'both' })
    expect(JSON.parse(localStorage.getItem(LAB_SETTINGS_KEY)!)).toEqual({
      enabled: true,
      chooser: 'both',
      writeMode: 'auto',
    })
    window.dispatchEvent(new StorageEvent('storage', { key: LAB_SETTINGS_KEY }))
    expect(getLabSettings()).toEqual({ enabled: true, chooser: 'both', writeMode: 'auto' })
  })

  it('falls back per field on corrupt stored values', () => {
    localStorage.setItem(
      LAB_SETTINGS_KEY,
      JSON.stringify({ chooser: 'laser', writeMode: 7, enabled: 'yes' }),
    )
    window.dispatchEvent(new StorageEvent('storage'))
    expect(getLabSettings()).toEqual(DEFAULT_LAB_SETTINGS)

    localStorage.setItem(LAB_SETTINGS_KEY, JSON.stringify({ chooser: 'any' }))
    window.dispatchEvent(new StorageEvent('storage'))
    expect(getLabSettings()).toEqual({ enabled: false, chooser: 'any', writeMode: 'auto' })
  })

  it('reads non-JSON storage content as the defaults without throwing', () => {
    localStorage.setItem(LAB_SETTINGS_KEY, 'not json {')
    expect(() => window.dispatchEvent(new StorageEvent('storage'))).not.toThrow()
    expect(getLabSettings()).toEqual(DEFAULT_LAB_SETTINGS)
  })

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useLabSettings())
    act(() => setLabSettings({ enabled: true }))
    expect(getLabSettings().enabled).toBe(true)
    expect(result.current.enabled).toBe(true)
  })

  it('returns the same snapshot between writes and a new one after a write', () => {
    const first = getLabSettings()
    expect(getLabSettings()).toBe(first)
    setLabSettings({ writeMode: 'with-response' })
    expect(getLabSettings()).not.toBe(first)
    expect(getLabSettings().writeMode).toBe('with-response')
  })

  it('re-renders a hook consumer after a change', () => {
    const { result } = renderHook(() => useLabSettings())
    expect(result.current.enabled).toBe(false)
    act(() => setLabSettings({ enabled: true }))
    expect(result.current.enabled).toBe(true)
  })

  it('records every change as a diagnostics event naming the changed fields', () => {
    setLabSettings({ enabled: true, chooser: 'any' })
    const events = getBleDiagnostics().events
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('lab-settings')
    expect(events[0]!.detail).toContain('enabled')
    expect(events[0]!.detail).toContain('any')
  })

  it('turns diagnostics persistence on with the lab and off again when the lab is disabled', () => {
    setLabSettings({ enabled: true })
    // The settings-change event itself is mirrored once persistence is on.
    expect(localStorage.getItem(BLE_DIAG_KEY)).not.toBeNull()

    setLabSettings({ enabled: false })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    recordBleEvent('after-off')
    expect(setItem).not.toHaveBeenCalledWith(BLE_DIAG_KEY, expect.anything())
  })
})
