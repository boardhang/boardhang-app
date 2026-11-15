// Web Bluetooth client for the DIY MoonBoard LED controller.
// TS port of shared/spec/ble-protocol.md (from
// ios/MoonBoardLED/BLE/MoonBoardBLEManager.swift). Separate reimplementation,
// not a shared binary.
//
// Two code paths share one client (docs/ble-hardware.md, "BLE lab"):
// - Lab off (the default, every user): the Nordic UART board only, found by its
//   service filter, written with `writeValueWithoutResponse` — byte for byte the
//   behaviour that shipped before the lab existed. The invariance suite pins it.
// - Lab on (an admin's own device): the picker can list both MoonBoard
//   controller generations, the client probes Nordic UART then RedBearLab after
//   connecting, and the ATT write type comes from the characteristic's
//   properties or from the admin's override. Everything is recorded in the
//   diagnostics store so a dark wall can be explained after the fact.

import type { HoldAssignment } from '../types'
import { displayed, protocolLetter } from '../types'
import { ledIndex } from '../board/geometry'
import { DEFAULT_LAB_SETTINGS, getLabSettings, type LabChooser, type LabSettings } from './labSettings'
import {
  describeRejection,
  formatProperties,
  formatWriters,
  recordBleEvent,
  setBleLinkSummary,
  type BleController,
  type BleLinkSummary,
  type BlePropertiesSnapshot,
  type BleWriteMode,
  type BleWriter,
} from './bleDiagnostics'

// Nordic UART Service UUIDs (must be lowercase for Web Bluetooth).
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e' // write (app → board)

/**
 * RedBearLab BLE service family — the first-generation official MoonBoard LED
 * box. `713d0003` is its write characteristic (app → board). Same `l#…#` frame
 * and 20-byte chunking as the Nordic boards; only the GATT addresses and the
 * accepted ATT write type differ. Reachable only through the admin BLE lab
 * (docs/ble-hardware.md); UUIDs match boardsesh's `transport.ts`.
 */
export const RBL_SERVICE = '713d0000-503e-4c75-ba94-3148f18d941e'
export const RBL_WRITE_CHAR = '713d0003-503e-4c75-ba94-3148f18d941e'

/**
 * Chooser request for the default (lab-off) path. Kept as a function so every
 * call hands Web Bluetooth a fresh, unfrozen object — the reverted dual-generation
 * release passed a frozen module constant, the leading hypothesis for why the
 * Bluefy shim stopped connecting.
 */
function nordicOnlyRequest(): RequestDeviceOptions {
  return { filters: [{ services: [NUS_SERVICE] }] }
}

/**
 * Chooser request for the lab's picker modes. Web Bluetooth ORs the filters and
 * grants access after connect to the union of `filters[].services` and
 * `optionalServices`, so a board matched by name alone can still open either
 * service. Only services listed here are ever visible to the page; `any`
 * therefore lets the probe try both known services on an unlisted box, nothing
 * more. Fresh object per call, never frozen.
 */
export function requestDeviceOptionsFor(chooser: LabChooser): RequestDeviceOptions {
  switch (chooser) {
    case 'both':
      return {
        filters: [{ services: [NUS_SERVICE] }, { services: [RBL_SERVICE] }, { namePrefix: 'MoonBoard' }],
        optionalServices: [NUS_SERVICE, RBL_SERVICE],
      }
    case 'any':
      return { acceptAllDevices: true, optionalServices: [NUS_SERVICE, RBL_SERVICE] }
    case 'nordic':
    default:
      return nordicOnlyRequest()
  }
}

/**
 * The firmware characteristic stores at most 20 bytes per write and silently
 * truncates the rest, so every message MUST be split into ≤20-byte writes. Do
 * NOT size from the MTU — modern stacks report ~180 but the firmware still only
 * keeps 20. Both controller generations buffer 20 bytes per write. See
 * shared/spec/ble-protocol.md.
 */
const MAX_CHUNK_LENGTH = 20

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/**
 * Which controller generation a connected board turned out to be. Named
 * "controller" (not "generation") to avoid colliding with the board layouts in
 * the board registry. The literal union lives in bleDiagnostics.ts so the client
 * and the diagnostics record can never drift apart.
 */
export type ControllerGeneration = BleController

/** How chunks are written on the current link (the diagnostics record's union). */
export type WriteMode = BleWriteMode

export interface MessageOptions {
  rows: number
  flipped: boolean
  showBeta: boolean
}

/**
 * Build the firmware message string for a set of holds. With beta off, the
 * left/right/match roles all light blue (right). Mirrors Swift `message(for:)`.
 */
export function buildMessage(holds: HoldAssignment[], opts: MessageOptions): string {
  const tokens = holds.map((h) => {
    const led = ledIndex(h.col, h.row, opts.rows, opts.flipped)
    const letter = protocolLetter[displayed(h.type, opts.showBeta)]
    return `${letter}${led}`
  })
  return 'l#' + tokens.join(',') + '#'
}

// Web Bluetooth API types come from @types/web-bluetooth (dev dependency).

function getBluetooth(): Bluetooth {
  const bt = navigator.bluetooth
  if (!bt) {
    throw new Error(
      'Web Bluetooth is not available. Use desktop Chrome/Edge over localhost/HTTPS, ' +
        'Android Chrome, or Bluefy on iPhone.',
    )
  }
  return bt
}

/**
 * Turn an unknown thrown/rejected BLE value into a message worth showing.
 * Desktop Chrome rejects GATT failures as full-text Errors, but the iOS Bluefy
 * shim can reject with a bare DOMException or a non-Error value — e.g. a numeric
 * code that `String()`s to "2" — which is useless to the user. A message with real
 * content passes through; a bare code or empty string falls back to a friendly,
 * actionable line. "Real content" = anything that isn't only digits, whitespace,
 * and punctuation — a Unicode-aware test so a localized (CJK/Cyrillic) message
 * from a non-English system locale still surfaces instead of the English fallback.
 */
export function describeBleError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : typeof err === 'string'
          ? err
          : ''
  const msg = raw.trim()
  if (msg && !/^[\d\s\p{P}]+$/u.test(msg)) return msg
  return "Couldn't reach the board — make sure it's on and in range, then try again."
}

/**
 * Toast text for a failed connect in the BLE lab: the readable message, plus the raw
 * rejection in brackets when it adds information (Bluefy's bare `2`, say).
 */
export function describeConnectFailure(failure: { message: string; raw: string }): string {
  return failure.raw !== failure.message ? `${failure.message} [${failure.raw}]` : failure.message
}

/**
 * True when a probe rejection means "this service/characteristic is not here"
 * rather than a broken link or a permission problem: Chrome's `NotFoundError`,
 * or a rejection carrying no name at all (the Bluefy shim rejects with bare
 * numeric codes). Any *other* name (`NetworkError`, `SecurityError`, …) is a
 * real failure that must surface as itself.
 */
function isAbsentRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return true
  const name = (err as { name: unknown }).name
  return typeof name !== 'string' || name === '' || name === 'NotFoundError'
}

/**
 * Diagnostics line for a chosen device. The id is read only on the lab path:
 * the default path must make exactly the getter reads it made before the lab
 * existed, and the Bluefy shim's behaviour on `id` is unverified.
 */
function describeDevice(device: BluetoothDevice, includeId: boolean): string {
  try {
    const name = device.name ?? '(unnamed)'
    return includeId ? `name=${name} id=${String(device.id).slice(0, 8)}` : `name=${name}`
  } catch {
    return 'unreadable'
  }
}

/** Beat to wait before the single retry below — short enough to be invisible. */
const RETRY_DELAY_MS = 120

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ChunkWriter = (chunk: BufferSource) => Promise<void>

const NO_KNOWN_SERVICE =
  'This device exposes no known MoonBoard LED service — pick a MoonBoard LED ' +
  'controller (a Nordic UART board or the original RedBearLab box).'

/**
 * Everything the client knows about the characteristic it is writing to. Built
 * in one synchronous step when a connection is committed and dropped in
 * `enterDisconnected`. A send captures the record it started with, so a stale
 * characteristic settling after a fast reconnect can never touch the new link.
 */
interface Link {
  characteristic: BluetoothRemoteGATTCharacteristic
  controller: ControllerGeneration
  mode: WriteMode
  /** True when the admin forced the mode instead of deriving it. */
  forced: boolean
  /** Which method carries the chunks; `direct` is the lab-off straight call. */
  writer: BleWriter
  /** Resolved once per link; null when no usable write method exists. */
  write: ChunkWriter | null
  /** Readable reason `write` is null. */
  missingMethod: string | null
}

/** The lab-off link: today's characteristic call, no probing, no property reads. */
function directLink(characteristic: BluetoothRemoteGATTCharacteristic): Link {
  return {
    characteristic,
    controller: 'nordic-uart',
    mode: 'without-response',
    forced: false,
    writer: 'direct',
    write: (chunk) => characteristic.writeValueWithoutResponse(chunk),
    missingMethod: null,
  }
}

/** `properties` as a plain snapshot; a thin shim may omit the object entirely. */
function snapshotProperties(characteristic: BluetoothRemoteGATTCharacteristic): BlePropertiesSnapshot {
  try {
    const p = (characteristic as Partial<BluetoothRemoteGATTCharacteristic>).properties
    if (!p) return { present: false, write: false, writeWithoutResponse: false, notify: false }
    return {
      present: true,
      write: p.write === true,
      writeWithoutResponse: p.writeWithoutResponse === true,
      notify: p.notify === true,
    }
  } catch {
    return { present: false, write: false, writeWithoutResponse: false, notify: false }
  }
}

/** Which write methods the characteristic exposes (a thin shim may lack the split pair). */
function availableWriters(characteristic: BluetoothRemoteGATTCharacteristic): Array<'with' | 'without' | 'legacy'> {
  const c = characteristic as Partial<BluetoothRemoteGATTCharacteristic>
  const found: Array<'with' | 'without' | 'legacy'> = []
  if (typeof c.writeValueWithResponse === 'function') found.push('with')
  if (typeof c.writeValueWithoutResponse === 'function') found.push('without')
  if (typeof c.writeValue === 'function') found.push('legacy')
  return found
}

/**
 * Derive the write mode from the controller generation and the properties.
 * The two failure directions are not symmetric: a wrong acknowledged write is
 * loud (the peripheral answers "write not permitted" and the browser rejects),
 * a wrong unacknowledged write is silent at every layer (CoreBluetooth drops
 * it and the browser reports success). So Nordic keeps the field-proven
 * unacknowledged mode unless the properties report *only* plain write, and
 * RedBearLab writes with response unless the properties rule it out — also
 * when the shim hides the properties altogether.
 */
function deriveWriteMode(controller: ControllerGeneration, properties: BlePropertiesSnapshot): WriteMode {
  if (controller === 'nordic-uart') {
    const onlyPlainWrite = properties.present && properties.write && !properties.writeWithoutResponse
    return onlyPlainWrite ? 'with-response' : 'without-response'
  }
  const onlyWithoutResponse = properties.present && properties.writeWithoutResponse && !properties.write
  return onlyWithoutResponse ? 'without-response' : 'with-response'
}

/**
 * Build the lab link: mode from the override or the properties, writer from
 * the split method for that mode, else legacy `writeValue` (Chrome then picks
 * the ATT type itself, so a forced mode is only nominal — recorded as such),
 * else none.
 */
function labLink(
  characteristic: BluetoothRemoteGATTCharacteristic,
  controller: ControllerGeneration,
  settings: LabSettings,
): { link: Link; properties: BlePropertiesSnapshot; writers: string[] } {
  const properties = snapshotProperties(characteristic)
  const writers = availableWriters(characteristic)
  const forced = settings.writeMode !== 'auto'
  const mode: WriteMode =
    settings.writeMode === 'auto' ? deriveWriteMode(controller, properties) : settings.writeMode
  const splitName = mode === 'with-response' ? 'writeValueWithResponse' : 'writeValueWithoutResponse'
  let writer: BleWriter = 'split'
  let write: ChunkWriter | null = null
  let missingMethod: string | null = null
  if (mode === 'with-response' && writers.includes('with')) {
    write = (chunk) => characteristic.writeValueWithResponse(chunk)
  } else if (mode === 'without-response' && writers.includes('without')) {
    write = (chunk) => characteristic.writeValueWithoutResponse(chunk)
  } else if (writers.includes('legacy')) {
    writer = 'legacy'
    write = (chunk) => characteristic.writeValue(chunk)
  } else {
    missingMethod =
      `This browser exposes no ${splitName} method for the board's characteristic, and no ` +
      'legacy writeValue either — change the write mode in the BLE lab or try Chrome, Edge, or Bluefy.'
  }
  return { link: { characteristic, controller, mode, forced, writer, write, missingMethod }, properties, writers }
}

/**
 * Backoff for silent reconnect attempts after an unexpected disconnect. Short
 * and finite: the board holds its own LED state, so the link only has to be
 * back by the next send — anything the backoff misses is caught by the
 * visibilitychange probe or the connect-on-demand path in useLightUp.
 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000]

/**
 * gatt.connect() has no built-in timeout and can hang indefinitely on a flaky
 * link. A forever-pending `inflight` would wedge every future connect() (user
 * taps included) at 'connecting' — and the UI offers no escape while
 * connecting — so cap the attempt and abort via gatt.disconnect().
 */
const CONNECT_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new Error("Connecting to the board timed out — make sure it's on and in range."))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err as Error)
      },
    )
  })
}

/**
 * Stateful client wrapping a single board connection. Call `onStateChange` to
 * surface connection state to React.
 *
 * Reconnect model (mirrors the iOS manager's `userInitiatedDisconnect`
 * invariant, see docs/ble-hardware.md): an *unexpected* disconnect keeps the
 * `BluetoothDevice` — permission to it persists for the life of the page, so
 * `gatt.connect()` reconnects without the chooser — and retries on a short
 * backoff while the page is visible. An explicit `disconnect()` drops the
 * device and suppresses all reconnecting until the next `connect()`.
 */
export class MoonBoardClient {
  private device: BluetoothDevice | null = null
  private link: Link | null = null
  private onDisconnected = () => this.handleDisconnected()
  private onVisibilityChange = () => this.handleVisibilityChange()
  private userDisconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private inflight: Promise<void> | null = null
  /**
   * Lab settings snapshot for the current connect attempt. Taken once when a
   * user-initiated connect starts and reused by its silent reconnects, so a
   * settings change can never alter a live attempt mid-flight.
   */
  private lab: LabSettings = DEFAULT_LAB_SETTINGS

  state: ConnectionState = 'disconnected'
  deviceName: string | null = null
  onStateChange: (() => void) | null = null

  /** Controller generation of the connected board; null while disconnected. */
  get controller(): ControllerGeneration | null {
    return this.link?.controller ?? null
  }

  /** Write mode in use on the current link; null while disconnected. */
  get writeMode(): WriteMode | null {
    return this.link?.mode ?? null
  }

  constructor() {
    // Android Chrome throttles, freezes, and eventually discards a backgrounded
    // PWA; the GATT link dies with it — sometimes without gattserverdisconnected
    // ever being delivered (frozen pages don't run queued tasks). Re-check the
    // link every time the page comes back to the foreground.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  /** Detach the document listener and cancel pending reconnects (for tests). */
  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
    this.clearReconnectTimer()
  }

  private setState(state: ConnectionState, deviceName: string | null) {
    this.state = state
    this.deviceName = deviceName
    this.onStateChange?.()
  }

  /**
   * Connect to the board. With a device retained from an earlier connection
   * this reconnects silently via `gatt.connect()` — no chooser. Otherwise it
   * prompts the picker and must be called from a user gesture.
   */
  async connect(): Promise<void> {
    this.userDisconnect = false
    this.clearReconnectTimer()
    if (this.inflight) {
      // Join the in-flight attempt, but keep the user-facing failure contract
      // below: a failure the user observes drops the device → next tap choosers.
      try {
        await this.inflight
        return
      } catch (err) {
        this.cleanup()
        throw err
      }
    }

    // A fresh attempt snapshots the lab settings; everything below (and the
    // attempt's silent reconnects) reads `this.lab`, never the store.
    this.lab = getLabSettings()
    const labLine = this.lab.enabled
      ? `lab=on chooser=${this.lab.chooser} writeMode=${this.lab.writeMode}`
      : 'lab=off'

    const retained = this.device
    if (retained) {
      recordBleEvent('connect', `${labLine} retained=${retained.name ?? '(unnamed)'}`)
      this.setState('connecting', retained.name ?? 'MoonBoard')
      try {
        await this.establish(retained)
        return
      } catch (err) {
        // Board unreachable (off, out of range). Drop it so the next tap opens
        // the chooser — chaining into requestDevice() here would outlive the
        // transient user activation a chooser needs. The attempt that owns the
        // failure records it once (silent reconnects record `reconnect-failed`).
        recordBleEvent('connect-failed', describeRejection(err))
        this.cleanup()
        throw err
      }
    }

    const bluetooth = getBluetooth()
    recordBleEvent('connect', labLine)
    this.setState('connecting', null)
    let device: BluetoothDevice
    try {
      device = await bluetooth.requestDevice(
        this.lab.enabled ? requestDeviceOptionsFor(this.lab.chooser) : nordicOnlyRequest(),
      )
    } catch (err) {
      recordBleEvent('requestDevice-rejected', describeRejection(err))
      this.cleanup()
      throw err
    }
    recordBleEvent('device', describeDevice(device, this.lab.enabled))
    this.device = device
    device.addEventListener('gattserverdisconnected', this.onDisconnected)
    try {
      await this.establish(device)
    } catch (err) {
      recordBleEvent('connect-failed', describeRejection(err))
      this.cleanup()
      throw err
    }
  }

  /**
   * GATT connect + service/characteristic resolution, deduped across callers.
   *
   * Lab off: the Nordic UART pair only, exactly as before the lab existed.
   * Lab on: the Nordic UART pair first (the common case; a missing service
   * rejects fast), then the RedBearLab pair. It falls through on *any* Nordic
   * rejection — including the nameless numeric ones the Bluefy shim produces —
   * because gating on an error name would break the original box on iOS.
   * Reconnects re-run `establish`, so the probe is repeated on every connect.
   */
  private establish(device: BluetoothDevice): Promise<void> {
    let phase = 'gatt.connect'
    this.inflight ??= withTimeout(
      (async () => {
        const server = await device.gatt!.connect()
        recordBleEvent('gatt-connected')
        let link: Link
        let properties: BlePropertiesSnapshot | 'not read' = 'not read'
        let writers: string[] | 'not probed' = 'not probed'
        if (!this.lab.enabled) {
          phase = 'nordic-uart lookup'
          const service = await server.getPrimaryService(NUS_SERVICE)
          const characteristic = await service.getCharacteristic(RX_CHAR)
          if (this.bailedOut(device)) return
          link = directLink(characteristic)
        } else {
          const resolved = await this.probe(device, server, (p) => (phase = p))
          if (!resolved) return
          if (this.bailedOut(device)) return
          const built = labLink(resolved.characteristic, resolved.controller, this.lab)
          link = built.link
          properties = built.properties
          writers = built.writers
          recordBleEvent('properties', formatProperties(properties))
          recordBleEvent('writers', formatWriters(writers))
        }
        this.link = link
        this.reconnectAttempt = 0
        recordBleEvent(
          'link',
          `controller=${link.controller} mode=${link.mode} forced=${link.forced} writer=${link.writer}` +
            (link.missingMethod ? ' write=unavailable' : ''),
        )
        const summary: BleLinkSummary = {
          deviceName: device.name ?? null,
          controller: link.controller,
          writeMode: link.mode,
          forced: link.forced,
          writer: link.writer,
          properties,
          writers,
          lastAction: null,
        }
        setBleLinkSummary(summary)
        this.setState('connected', device.name ?? 'MoonBoard')
      })(),
      CONNECT_TIMEOUT_MS,
      () => {
        recordBleEvent('connect-timeout', `pending=${phase}`)
        device.gatt?.disconnect()
      },
    ).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /**
   * Lab-on service resolution: Nordic UART, then RedBearLab. Resolves to null
   * when a user disconnect landed mid-probe (nothing to surface); rejects with
   * a readable error when neither service is present, or with the named
   * failure itself when the link dropped or access was denied.
   */
  private async probe(
    device: BluetoothDevice,
    server: BluetoothRemoteGATTServer,
    setPhase: (phase: string) => void,
  ): Promise<{ characteristic: BluetoothRemoteGATTCharacteristic; controller: ControllerGeneration } | null> {
    try {
      setPhase('nordic-uart lookup')
      const service = await server.getPrimaryService(NUS_SERVICE)
      const characteristic = await service.getCharacteristic(RX_CHAR)
      recordBleEvent('probe', 'nordic-uart ok')
      return { characteristic, controller: 'nordic-uart' }
    } catch (nordicErr) {
      recordBleEvent('probe', `nordic-uart failed: ${describeRejection(nordicErr)}`)
      // Reduced guard before the second GATT call: a user disconnect that
      // landed mid-probe must not trigger another lookup or surface an error.
      // Deliberately NOT `gatt.connected` — Chrome drops that flag before a
      // lookup rejects with NetworkError, and checking it here would swallow a
      // real link drop as a silent bail instead of surfacing it below.
      if (this.userDisconnect || this.device !== device) {
        device.gatt?.disconnect()
        return null
      }
      try {
        setPhase('redbearlab lookup')
        const service = await server.getPrimaryService(RBL_SERVICE)
        const characteristic = await service.getCharacteristic(RBL_WRITE_CHAR)
        recordBleEvent('probe', 'redbearlab ok')
        return { characteristic, controller: 'redbearlab' }
      } catch (rblErr) {
        recordBleEvent('probe', `redbearlab failed: ${describeRejection(rblErr)}`)
        // Don't leave a GATT link open to a device we cannot drive.
        device.gatt?.disconnect()
        if (this.userDisconnect || this.device !== device) return null
        if (isAbsentRejection(nordicErr) && isAbsentRejection(rblErr)) throw new Error(NO_KNOWN_SERVICE)
        // A named failure (link drop, permission) surfaces as itself.
        throw isAbsentRejection(nordicErr) ? rblErr : nordicErr
      }
    }
  }

  /**
   * A disconnect — user or link — may have landed while the lookups were
   * pending; committing now would resurrect a severed connection (state
   * 'connected' with no device). `=== false` (not `!connected`): the Bluefy
   * shim may not implement `connected`.
   */
  private bailedOut(device: BluetoothDevice): boolean {
    if (this.userDisconnect || this.device !== device || device.gatt?.connected === false) {
      device.gatt?.disconnect()
      return true
    }
    return false
  }

  disconnect(): void {
    this.userDisconnect = true
    this.clearReconnectTimer()
    // The lab card disconnects before every setting change (R23), usually with no
    // device at all; only record a disconnect when there was something to disconnect.
    if (this.device) recordBleEvent('disconnected', 'user')
    this.device?.gatt?.disconnect()
    this.cleanup()
  }

  private handleDisconnected() {
    // Unexpected drop (out of range, board power-cycled, Android reclaimed the
    // link from a backgrounded PWA). Keep the device for chooser-free reconnect.
    //
    // Chrome also echoes the client's *own* gatt.disconnect() (a failed lookup,
    // the connect timeout, a guard bail) back through this event — while state
    // is still 'connecting', or already 'disconnected'. The attempt that issued
    // it owns the retry, so only a drop from 'connected' restarts the backoff;
    // otherwise every failed attempt would reset the counter and a retained
    // box that connects but fails resolution would loop forever.
    const freshDrop = this.state === 'connected'
    recordBleEvent('disconnected', freshDrop ? 'link' : `echo state=${this.state}`)
    this.enterDisconnected()
    if (freshDrop) this.reconnectAttempt = 0
    this.scheduleReconnect()
  }

  private handleVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      // Background timers are throttled/frozen anyway; retry on return instead.
      this.clearReconnectTimer()
      return
    }
    if (this.userDisconnect || !this.device || this.state === 'connecting') return
    if (this.state === 'connected' && this.device.gatt?.connected) return
    // Either a known disconnect, or the link died while the page was frozen and
    // the disconnect event was never delivered — state still claims connected.
    this.enterDisconnected()
    this.reconnectAttempt = 0
    this.clearReconnectTimer()
    void this.tryReconnect()
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.userDisconnect || !this.device) return
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const wait = RECONNECT_DELAYS_MS[this.reconnectAttempt]
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.tryReconnect()
    }, wait)
  }

  private async tryReconnect(): Promise<void> {
    const device = this.device
    if (!device || this.userDisconnect || this.state !== 'disconnected') return
    recordBleEvent('reconnect', `attempt=${this.reconnectAttempt}`)
    this.setState('connecting', device.name ?? 'MoonBoard')
    try {
      await this.establish(device)
    } catch (err) {
      console.warn('[ble] auto-reconnect failed:', describeBleError(err))
      recordBleEvent('reconnect-failed', describeRejection(err))
      this.enterDisconnected()
      this.scheduleReconnect()
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** Known-disconnected, keeping the device for chooser-free reconnect. */
  private enterDisconnected() {
    this.link = null
    setBleLinkSummary(null)
    this.setState('disconnected', null)
  }

  /** Full teardown: also drop the device, so the next connect() choosers. */
  private cleanup() {
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    this.device = null
    this.clearReconnectTimer()
    this.enterDisconnected()
  }

  /** Send the given holds to the board. */
  async send(holds: HoldAssignment[], opts: MessageOptions): Promise<void> {
    await this.write(buildMessage(holds, opts))
  }

  /** Turn all LEDs off (empty problem string). */
  async clear(): Promise<void> {
    await this.write('l##')
  }

  /** Light exactly one LED by strip index — the calibration message (`l#P<n>#`). */
  async lightLed(index: number): Promise<void> {
    await this.write(`l#P${index}#`)
  }

  /**
   * ASCII-encode, split into ≤20-byte chunks, and send each with the link's
   * writer, awaited sequentially. Awaiting each write is the web equivalent of
   * CoreBluetooth's flow-controlled queue (back-pressure); with acknowledged
   * writes it is a true ATT-level acknowledgement.
   */
  private async write(message: string): Promise<void> {
    const link = this.link
    if (!link || this.state !== 'connected') {
      throw new Error('Not connected')
    }
    if (!link.write) throw new Error(link.missingMethod ?? 'No write method available')
    const bytes = asciiEncode(message)
    const chunks = Math.ceil(bytes.length / MAX_CHUNK_LENGTH)
    const started = Date.now()
    recordBleEvent('send', `bytes=${bytes.length} chunks=${chunks} mode=${link.mode} writer=${link.writer}`)
    try {
      for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_LENGTH) {
        // slice() copies into a fresh ArrayBuffer, satisfying BufferSource.
        const chunk = bytes.slice(offset, offset + MAX_CHUNK_LENGTH)
        await writeChunk(link.write, chunk)
      }
      recordBleEvent('send-ok', `ms=${Date.now() - started}`)
    } catch (err) {
      recordBleEvent('send-failed', describeRejection(err))
      throw err
    }
  }
}

/**
 * A write can transiently reject (GATT momentarily busy, a radio hiccup) even
 * on a healthy connection. Retry once after a short beat before giving up; a
 * genuine failure (disconnected, out of range) rejects again and propagates.
 * Log the swallowed first error — otherwise a board that retries on every
 * chunk looks perfectly healthy and its flakiness leaves no trail.
 */
async function writeChunk(write: ChunkWriter, chunk: BufferSource): Promise<void> {
  try {
    await write(chunk)
  } catch (err) {
    console.warn('[ble] write retry after transient failure:', describeBleError(err))
    recordBleEvent('chunk-retry', describeRejection(err))
    await delay(RETRY_DELAY_MS)
    await write(chunk)
  }
}

function asciiEncode(message: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(message.length))
  for (let i = 0; i < message.length; i++) {
    bytes[i] = message.charCodeAt(i) & 0x7f
  }
  return bytes
}
