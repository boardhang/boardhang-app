// Web Bluetooth client for the DIY MoonBoard LED controller.
// TS port of shared/spec/ble-protocol.md (from
// ios/MoonBoardLED/BLE/MoonBoardBLEManager.swift). Separate reimplementation,
// not a shared binary.

import type { HoldAssignment } from '../types'
import { displayed, protocolLetter } from '../types'
import { ledIndex } from '../board/geometry'

// Nordic UART Service UUIDs (must be lowercase for Web Bluetooth).
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e' // write (app → board)

/**
 * The firmware characteristic stores at most 20 bytes per write and silently
 * truncates the rest, so every message MUST be split into ≤20-byte writes. Do
 * NOT size from the MTU — modern stacks report ~180 but the firmware still only
 * keeps 20. See shared/spec/ble-protocol.md.
 */
const MAX_CHUNK_LENGTH = 20

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

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

/** Beat to wait before the single retry below — short enough to be invisible. */
const RETRY_DELAY_MS = 120

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * writeValueWithoutResponse can transiently reject (GATT momentarily busy, a
 * radio hiccup) even on a healthy connection. Retry once after a short beat
 * before giving up; a genuine failure (disconnected, out of range) rejects again
 * and propagates. Log the swallowed first error — otherwise a board that retries
 * on every chunk looks perfectly healthy and its flakiness leaves no trail.
 */
async function writeWithRetry(
  characteristic: BluetoothRemoteGATTCharacteristic,
  chunk: BufferSource,
): Promise<void> {
  try {
    await characteristic.writeValueWithoutResponse(chunk)
  } catch (err) {
    console.warn('[ble] write retry after transient failure:', describeBleError(err))
    await delay(RETRY_DELAY_MS)
    await characteristic.writeValueWithoutResponse(chunk)
  }
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
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
  private onDisconnected = () => this.handleDisconnected()
  private onVisibilityChange = () => this.handleVisibilityChange()
  private userDisconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private inflight: Promise<void> | null = null

  state: ConnectionState = 'disconnected'
  deviceName: string | null = null
  onStateChange: (() => void) | null = null

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

    const retained = this.device
    if (retained) {
      this.setState('connecting', retained.name ?? 'MoonBoard')
      try {
        await this.establish(retained)
        return
      } catch (err) {
        // Board unreachable (off, out of range). Drop it so the next tap opens
        // the chooser — chaining into requestDevice() here would outlive the
        // transient user activation a chooser needs.
        this.cleanup()
        throw err
      }
    }

    const bluetooth = getBluetooth()
    this.setState('connecting', null)
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
      })
      this.device = device
      device.addEventListener('gattserverdisconnected', this.onDisconnected)
      await this.establish(device)
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  /** GATT connect + service/characteristic resolution, deduped across callers. */
  private establish(device: BluetoothDevice): Promise<void> {
    this.inflight ??= withTimeout(
      (async () => {
        const server = await device.gatt!.connect()
        const service = await server.getPrimaryService(NUS_SERVICE)
        const characteristic = await service.getCharacteristic(RX_CHAR)
        // A disconnect — user or link — may have landed while the awaits above
        // were pending; committing now would resurrect a severed connection
        // (state 'connected' with no device). Bail out instead. `=== false`
        // (not `!connected`): the Bluefy shim may not implement `connected`.
        if (this.userDisconnect || this.device !== device || device.gatt?.connected === false) {
          device.gatt?.disconnect()
          return
        }
        this.characteristic = characteristic
        this.reconnectAttempt = 0
        this.setState('connected', device.name ?? 'MoonBoard')
      })(),
      CONNECT_TIMEOUT_MS,
      () => device.gatt?.disconnect(),
    ).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  disconnect(): void {
    this.userDisconnect = true
    this.clearReconnectTimer()
    this.device?.gatt?.disconnect()
    this.cleanup()
  }

  private handleDisconnected() {
    // Unexpected drop (out of range, board power-cycled, Android reclaimed the
    // link from a backgrounded PWA). Keep the device for chooser-free reconnect.
    this.enterDisconnected()
    this.reconnectAttempt = 0
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
    this.setState('connecting', device.name ?? 'MoonBoard')
    try {
      await this.establish(device)
    } catch (err) {
      console.warn('[ble] auto-reconnect failed:', describeBleError(err))
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
    this.characteristic = null
    this.setState('disconnected', null)
  }

  /** Full teardown: also drop the device, so the next connect() choosers. */
  private cleanup() {
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    this.device = null
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

  /**
   * ASCII-encode, split into ≤20-byte chunks, and send each via
   * writeValueWithoutResponse awaited sequentially. Awaiting each write is the
   * web equivalent of CoreBluetooth's flow-controlled queue (back-pressure).
   */
  private async write(message: string): Promise<void> {
    const characteristic = this.characteristic
    if (!characteristic || this.state !== 'connected') {
      throw new Error('Not connected')
    }
    const bytes = asciiEncode(message)
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_LENGTH) {
      // slice() copies into a fresh ArrayBuffer, satisfying BufferSource.
      const chunk = bytes.slice(offset, offset + MAX_CHUNK_LENGTH)
      await writeWithRetry(characteristic, chunk)
    }
  }
}

function asciiEncode(message: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(message.length))
  for (let i = 0; i < message.length; i++) {
    bytes[i] = message.charCodeAt(i) & 0x7f
  }
  return bytes
}
