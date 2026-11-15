// Device-local settings for the admin "BLE lab" (docs/ble-hardware.md). Three knobs:
// whether the experimental Bluetooth path is on at all, how the device picker searches,
// and whether the write type is derived from the characteristic or forced.
//
// The Bluetooth client reads these synchronously at connect time and never consults
// auth; only the admin card in Settings can change them. Unlike themeStore/previewsStore,
// the in-memory snapshot is the source of truth and storage is a best-effort mirror —
// re-reading storage on every write would snap the lab back to "off" in embedders where
// localStorage throws (Safari private mode, Bluefy), which is exactly where it is needed.
// The `storage` event (cross-tab, and the test reset idiom) is the one place that
// rebuilds the snapshot from storage.

import { useSyncExternalStore } from 'react'
import { recordBleEvent, setBleDiagnosticsPersistence, type BleWriteMode } from './bleDiagnostics'

export type LabChooser = 'nordic' | 'both' | 'any'
/** `auto` derives the write type from the characteristic; the others force one. */
export type LabWriteMode = 'auto' | BleWriteMode

export interface LabSettings {
  /** Master switch. Off = today's Bluetooth path, byte for byte. */
  enabled: boolean
  /** Which devices the picker lists: today's Nordic UART filter, both known MoonBoard
   *  controller services plus the `MoonBoard` name prefix, or any nearby device. */
  chooser: LabChooser
  /** `auto` derives the ATT write type from the characteristic; the others force it. */
  writeMode: LabWriteMode
}

export const LAB_SETTINGS_KEY = 'ble.lab.v1'
export const LAB_CHOOSERS: readonly LabChooser[] = ['nordic', 'both', 'any']
export const LAB_WRITE_MODES: readonly LabWriteMode[] = ['auto', 'with-response', 'without-response']
export const DEFAULT_LAB_SETTINGS: LabSettings = Object.freeze({
  enabled: false,
  chooser: 'nordic',
  writeMode: 'auto',
})

function isChooser(value: unknown): value is LabChooser {
  return typeof value === 'string' && (LAB_CHOOSERS as readonly string[]).includes(value)
}

function isWriteMode(value: unknown): value is LabWriteMode {
  return typeof value === 'string' && (LAB_WRITE_MODES as readonly string[]).includes(value)
}

/** Validate per field so one bad value never discards the others. */
function read(): LabSettings {
  try {
    const raw = localStorage.getItem(LAB_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_LAB_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_LAB_SETTINGS }
    const p = parsed as Record<string, unknown>
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_LAB_SETTINGS.enabled,
      chooser: isChooser(p.chooser) ? p.chooser : DEFAULT_LAB_SETTINGS.chooser,
      writeMode: isWriteMode(p.writeMode) ? p.writeMode : DEFAULT_LAB_SETTINGS.writeMode,
    }
  } catch {
    return { ...DEFAULT_LAB_SETTINGS }
  }
}

function write(settings: LabSettings): void {
  try {
    localStorage.setItem(LAB_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Best-effort — restricted embedders (Safari private mode, Bluefy) can throw.
  }
}

const listeners = new Set<() => void>()
let snapshot: LabSettings = read()
setBleDiagnosticsPersistence(snapshot.enabled)

function notify(): void {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  // Cross-tab change, or the test reset idiom (a bare StorageEvent has key === null).
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== LAB_SETTINGS_KEY) return
    snapshot = read()
    setBleDiagnosticsPersistence(snapshot.enabled)
    notify()
  })
}

/** Synchronous read for the Bluetooth client (which must not depend on React). */
export function getLabSettings(): LabSettings {
  return snapshot
}

export function setLabSettings(patch: Partial<LabSettings>): void {
  const previous = snapshot
  const next: LabSettings = { ...previous, ...patch }
  snapshot = next
  write(next)
  // Persistence first, so the change event below is mirrored when the lab turns on.
  setBleDiagnosticsPersistence(next.enabled)
  const changed = (Object.keys(patch) as (keyof LabSettings)[])
    .filter((k) => previous[k] !== next[k])
    .map((k) => `${k}=${String(next[k])}`)
  if (changed.length > 0) recordBleEvent('lab-settings', changed.join(' '))
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive lab settings for the Settings card. */
export function useLabSettings(): LabSettings {
  return useSyncExternalStore(subscribe, getLabSettings)
}
