// In-app Bluetooth diagnostics for the admin "BLE lab" (docs/ble-hardware.md).
//
// A capped ring buffer of timestamped events plus a summary of the current link.
// The in-memory snapshot is the source of truth; it is recorded on BOTH the default
// and the experimental client path so the lab-off path can serve as the control run.
// Persistence to localStorage is opt-in (switched on by the lab settings store while
// the lab is enabled) so no key is written for users who never touch the lab.
// Recording never throws into the caller and never awaits — a diagnostics failure
// must not be able to change what the Bluetooth path does.

import { useSyncExternalStore } from 'react'

export const BLE_DIAG_KEY = 'ble.diag.v1'
export const BLE_DIAG_CAP = 100
/** Longest detail string kept per event — keeps the mirrored key small. */
const MAX_DETAIL_LENGTH = 400

export interface BleEvent {
  /** Epoch milliseconds. */
  t: number
  kind: string
  detail?: string
}

export type BleController = 'nordic-uart' | 'redbearlab'
export type BleWriteMode = 'with-response' | 'without-response'
/** How chunks reach the characteristic: a split method, legacy `writeValue`, or the
 *  lab-off direct call (no probing of which methods exist). */
export type BleWriter = 'split' | 'legacy' | 'direct'

export interface BlePropertiesSnapshot {
  write: boolean
  writeWithoutResponse: boolean
  notify: boolean
  /** False when the shim exposed no `properties` object at all. */
  present: boolean
}

export interface BleLinkSummary {
  deviceName: string | null
  controller: BleController | null
  writeMode: BleWriteMode | null
  forced: boolean
  writer: BleWriter | null
  /** The characteristic's properties, or 'not read' on the lab-off path. */
  properties: BlePropertiesSnapshot | 'not read' | null
  /** Which write methods the characteristic exposes, or 'not probed' on the lab-off path. */
  writers: string[] | 'not probed' | null
  /** Result of the last quick action from the lab card. */
  lastAction: string | null
}

export interface BleDiagnosticsSnapshot {
  /** Oldest first. The UI reverses for display. */
  events: BleEvent[]
  link: BleLinkSummary | null
}

const EMPTY: BleDiagnosticsSnapshot = { events: [], link: null }

let snapshot: BleDiagnosticsSnapshot = EMPTY
let persist = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

function commit(next: BleDiagnosticsSnapshot): void {
  snapshot = next
  if (persist) writeEvents(next.events)
  notify()
}

function isEvent(value: unknown): value is BleEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.t === 'number' &&
    typeof v.kind === 'string' &&
    (v.detail === undefined || typeof v.detail === 'string')
  )
}

function readEvents(): BleEvent[] {
  try {
    const raw = localStorage.getItem(BLE_DIAG_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEvent).slice(-BLE_DIAG_CAP)
  } catch {
    return []
  }
}

function writeEvents(events: BleEvent[]): void {
  try {
    localStorage.setItem(BLE_DIAG_KEY, JSON.stringify(events))
  } catch {
    // Best-effort — restricted embedders (Safari private mode, Bluefy) can throw.
  }
}

function removeStored(): void {
  try {
    localStorage.removeItem(BLE_DIAG_KEY)
  } catch {
    // Best-effort.
  }
}

function stringifyDetail(detail: unknown): string | undefined {
  if (detail === undefined) return undefined
  let text: string
  if (typeof detail === 'string') text = detail
  else if (typeof detail === 'number' || typeof detail === 'boolean' || typeof detail === 'bigint') {
    text = String(detail)
  } else if (detail === null) text = 'null'
  else {
    try {
      text = JSON.stringify(detail) ?? String(detail)
    } catch {
      text = '[unserializable detail]'
    }
  }
  return text.length > MAX_DETAIL_LENGTH ? text.slice(0, MAX_DETAIL_LENGTH) + '…' : text
}

/**
 * One compact line describing an unknown rejection — enough to tell a Chrome
 * DOMException from a bare numeric code the Bluefy shim produces.
 */
export function describeRejection(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { name?: unknown; code?: unknown; message?: unknown }
    const name = typeof e.name === 'string' && e.name ? e.name : err.constructor?.name || 'object'
    const code = e.code !== undefined && e.code !== null && e.code !== 0 ? ` code=${String(e.code)}` : ''
    const message = typeof e.message === 'string' ? e.message : ''
    let str = ''
    try {
      str = String(err)
    } catch {
      str = ''
    }
    const suffix = str && str !== message && !str.endsWith(message) ? ` str=${str}` : ''
    return `${name}${code}: ${message}${suffix}`.trim()
  }
  let str: string
  try {
    str = String(err)
  } catch {
    str = '?'
  }
  return `${typeof err}: ${str}`
}

/** Append an event. Never throws; never awaits. */
export function recordBleEvent(kind: string, detail?: unknown): void {
  try {
    const event: BleEvent = { t: Date.now(), kind }
    const text = stringifyDetail(detail)
    if (text !== undefined) event.detail = text
    const events = [...snapshot.events, event].slice(-BLE_DIAG_CAP)
    commit({ events, link: snapshot.link })
  } catch {
    // Diagnostics must never affect the Bluetooth path.
  }
}

export function setBleLinkSummary(link: BleLinkSummary | null): void {
  try {
    commit({ events: snapshot.events, link })
  } catch {
    // Never affect the caller.
  }
}

/** Patch the current link summary (e.g. the last quick action). No-op without a link. */
export function updateBleLinkSummary(patch: Partial<BleLinkSummary>): void {
  try {
    if (!snapshot.link) return
    commit({ events: snapshot.events, link: { ...snapshot.link, ...patch } })
  } catch {
    // Never affect the caller.
  }
}

/**
 * Switch the localStorage mirror on or off. Turning it on restores stored events
 * only when nothing has been recorded yet this session; otherwise the in-memory
 * buffer (e.g. a lab-off control run) wins and is written to the key.
 */
export function setBleDiagnosticsPersistence(on: boolean): void {
  try {
    persist = on
    if (!on) return
    if (snapshot.events.length === 0) {
      const stored = readEvents()
      if (stored.length > 0) {
        snapshot = { events: stored, link: snapshot.link }
        notify()
      }
    }
    writeEvents(snapshot.events)
  } catch {
    // Never affect the caller.
  }
}

/** Empty the log and the link summary; drops the stored copy while persistence is on. */
export function clearBleDiagnostics(): void {
  snapshot = EMPTY
  if (persist) removeStored()
  notify()
}

/** Test seam: forget everything in memory and turn persistence off. Leaves storage alone. */
export function resetBleDiagnostics(): void {
  snapshot = EMPTY
  persist = false
  notify()
}

export function getBleDiagnostics(): BleDiagnosticsSnapshot {
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive diagnostics for the lab card. */
export function useBleDiagnostics(): BleDiagnosticsSnapshot {
  return useSyncExternalStore(subscribe, getBleDiagnostics)
}

function describeLink(link: BleLinkSummary | null): string {
  if (!link) return 'Link: none'
  const properties =
    link.properties === null
      ? 'unknown'
      : typeof link.properties === 'string'
        ? link.properties
        : link.properties.present
          ? `write=${link.properties.write} writeWithoutResponse=${link.properties.writeWithoutResponse} notify=${link.properties.notify}`
          : 'absent'
  const writers =
    link.writers === null
      ? 'unknown'
      : Array.isArray(link.writers)
        ? link.writers.join('+') || 'none'
        : link.writers
  return (
    `Link: ${link.deviceName ?? '(unnamed)'} controller=${link.controller ?? 'none'} ` +
    `writeMode=${link.writeMode ?? 'none'} forced=${link.forced} writer=${link.writer ?? 'none'} ` +
    `properties=[${properties}] writers=[${writers}] lastAction=${link.lastAction ?? 'none'}`
  )
}

/** Plain-text export for the Copy button: settings, link, then events oldest first. */
export function formatBleDiagnostics(settings: {
  enabled: boolean
  chooser: string
  writeMode: string
}): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const lines = [
    'Boardhang BLE diagnostics',
    `UA: ${ua}`,
    `Lab: enabled=${settings.enabled} chooser=${settings.chooser} writeMode=${settings.writeMode}`,
    describeLink(snapshot.link),
    `Events (${snapshot.events.length}, oldest first):`,
  ]
  for (const e of snapshot.events) {
    lines.push(
      `${new Date(e.t).toISOString()} ${e.kind}${e.detail !== undefined ? ' ' + e.detail : ''}`,
    )
  }
  return lines.join('\n')
}