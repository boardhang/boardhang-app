// Web Bluetooth client for the MoonBoard LED controller — both the DIY /
// second-generation Nordic UART boards (ArduinoMoonBoardLED firmware) and the
// first-generation official box (RedBearLab BLE module). Same wire format and
// chunking on both; only the GATT service and the write mode differ.
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
 * RedBearLab BLE service family — the first-generation official MoonBoard LED
 * box. `713d0003` is its write characteristic (app → board). Same
 * `l#…#` frame and 20-byte chunking as the Nordic boards; only the GATT
 * addresses differ. UUIDs confirmed against boardsesh's `transport.ts`.
 */
export const RBL_SERVICE = '713d0000-503e-4c75-ba94-3148f18d941e'
export const RBL_WRITE_CHAR = '713d0003-503e-4c75-ba94-3148f18d941e'

/**
 * Chooser request: Web Bluetooth ORs the filters, and access to a service after
 * connect is granted by the union of `filters[].services` and
 * `optionalServices` regardless of which filter matched — so a board found by
 * its `MoonBoard…` name alone can still open either service. Frozen: it is the
 * test seam and must not drift between callers.
 */
export const REQUEST_DEVICE_OPTIONS = Object.freeze({
  filters: [{ services: [NUS_SERVICE] }, { services: [RBL_SERVICE] }, { namePrefix: 'MoonBoard' }],
  optionalServices: [NUS_SERVICE, RBL_SERVICE],
}) satisfies RequestDeviceOptions

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
 * the board registry.
 */
export type ControllerGeneration = 'nordic-uart' | 'redbearlab'

/** How chunks are written on the current link. */
export type WriteMode = 'with-response' | 'without-response'

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

/** Beat to wait before the single retry below — short enough to be invisible. */
const RETRY_DELAY_MS = 120

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ChunkWriter = (chunk: BufferSource) => Promise<void>

/** Surfaced when the characteristic has none of the three write methods (R7). */
const NO_WRITE_METHOD =
  'This browser exposes no way to write to the board over Bluetooth — try Chrome, Edge, or Bluefy.'

/**
 * Everything the client knows about the characteristic it is writing to. Built
 * in one synchronous step when a connection is committed and dropped in
 * `enterDisconnected`; a `write` loop captures the record it started with and
 * only mutates `mode`/`proven` while that record is still current, so a
 * rejection from a stale characteristic after a fast reconnect cannot touch
 * the new link.
 */
interface Link {
  characteristic: BluetoothRemoteGATTCharacteristic
  controller: ControllerGeneration
  mode: WriteMode
  /**
   * False only on a RedBearLab link whose properties said nothing usable: the
   * acknowledged default is then a guess, and the first chunk that fails twice
   * in that mode is retried once without response (see `writeChunk`).
   */
  proven: boolean
  /** Resolved once per link: the split method for each mode, else legacy `writeValue`. */
  writers: Record<WriteMode, ChunkWriter | null>
}

/**
 * Derive the write mode from the controller generation and the characteristic
 * properties (which a thin shim may omit). The two failure directions are not
 * symmetric: a wrong acknowledged write is loud (the peripheral answers "write
 * not permitted" and the browser rejects), a wrong unacknowledged write is
 * silent at every layer (ATT write commands carry no error response). So:
 *
 * - Nordic UART keeps write-without-response — the mode proven in the field,
 *   including on the one shim that lacks properties — unless the properties
 *   report *only* plain write.
 * - RedBearLab writes with response whenever the properties allow it or say
 *   nothing, and without response only when the properties rule acknowledged
 *   writes out. Absent or empty properties leave the link *unproven*.
 */
function deriveWriteMode(
  controller: ControllerGeneration,
  properties: BluetoothCharacteristicProperties | undefined,
): { mode: WriteMode; proven: boolean } {
  const write = properties?.write === true
  const writeWithoutResponse = properties?.writeWithoutResponse === true
  if (controller === 'nordic-uart') {
    const onlyPlainWrite = write && properties?.writeWithoutResponse === false
    return { mode: onlyPlainWrite ? 'with-response' : 'without-response', proven: true }
  }
  if (write) return { mode: 'with-response', proven: true }
  if (writeWithoutResponse) return { mode: 'without-response', proven: true }
  return { mode: 'with-response', proven: false }
}

/**
 * Pick the write method for a mode once per link. The split
 * `writeValueWithResponse`/`writeValueWithoutResponse` pair dates from Chrome
 * 85 and may be missing on older shims; the legacy `writeValue` then stands in
 * (Chrome's legacy method writes with response when the `write` property is
 * present, so it is an automatic mode, not a degraded one). `null` when no
 * method exists at all — sends then fail with a readable message.
 */
function resolveWriters(characteristic: BluetoothRemoteGATTCharacteristic): Record<WriteMode, ChunkWriter | null> {
  const c = characteristic as Partial<BluetoothRemoteGATTCharacteristic>
  const legacy: ChunkWriter | null =
    typeof c.writeValue === 'function' ? (chunk) => characteristic.writeValue(chunk) : null
  return {
    'with-response':
      typeof c.writeValueWithResponse === 'function'
        ? (chunk) => characteristic.writeValueWithResponse(chunk)
        : legacy,
    'without-response':
      typeof c.writeValueWithoutResponse === 'function'
        ? (chunk) => characteristic.writeValueWithoutResponse(chunk)
        : legacy,
  }
}

function buildLink(
  characteristic: BluetoothRemoteGATTCharacteristic,
  controller: ControllerGeneration,
): Link {
  // `properties` is non-optional in the typings but a thin shim may omit it.
  const properties = characteristic.properties as BluetoothCharacteristicProperties | undefined
  const writers = resolveWriters(characteristic)
  const derived = deriveWriteMode(controller, properties)
  // The unproven flip retries without response through the *split* method; if
  // that method is missing the flip would re-run the same legacy call, so
  // treat the link as proven and keep the single same-mode retry.
  const flipPossible =
    typeof (characteristic as Partial<BluetoothRemoteGATTCharacteristic>).writeValueWithoutResponse ===
    'function'
  return {
    characteristic,
    controller,
    mode: derived.mode,
    proven: derived.proven || !flipPossible,
    writers,
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
  private link: Link | null = null
  private onDisconnected = () => this.handleDisconnected()
  private onVisibilityChange = () => this.handleVisibilityChange()
  private userDisconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private inflight: Promise<void> | null = null

  state: ConnectionState = 'disconnected'
  deviceName: string | null = null
  onStateChange: (() => void) | null = null

  /** Controller generation of the connected board; null while disconnected. Not shown in the UI. */
  get controller(): ControllerGeneration | null {
    return this.link?.controller ?? null
  }

  /** Write mode in use on the current link; null while disconnected. Not shown in the UI. */
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
      const device = await bluetooth.requestDevice(REQUEST_DEVICE_OPTIONS)
      this.device = device
      device.addEventListener('gattserverdisconnected', this.onDisconnected)
      await this.establish(device)
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  /**
   * GATT connect + service/characteristic resolution, deduped across callers.
   *
   * The probe tries the Nordic UART pair first (the common case; a missing
   * service rejects fast), then the RedBearLab pair. It falls through on *any*
   * Nordic rejection — including the nameless numeric ones the Bluefy shim
   * produces — because gating on an error name would break the original box on
   * iOS. Reconnects re-run `establish`, so the probe is repeated on every
   * connect; nothing is remembered per board.
   */
  private establish(device: BluetoothDevice): Promise<void> {
    this.inflight ??= withTimeout(
      (async () => {
        const server = await device.gatt!.connect()
        let characteristic: BluetoothRemoteGATTCharacteristic
        let controller: ControllerGeneration
        try {
          const service = await server.getPrimaryService(NUS_SERVICE)
          characteristic = await service.getCharacteristic(RX_CHAR)
          controller = 'nordic-uart'
        } catch (nordicErr) {
          // Reduced guard before the second GATT call: a user disconnect that
          // landed mid-probe must not trigger another lookup or surface an
          // error. Deliberately NOT `gatt.connected` — Chrome drops that flag
          // before a lookup rejects with NetworkError, and checking it here
          // would swallow a real link drop as a silent bail instead of
          // surfacing it below.
          if (this.userDisconnect || this.device !== device) {
            device.gatt?.disconnect()
            return
          }
          try {
            const service = await server.getPrimaryService(RBL_SERVICE)
            characteristic = await service.getCharacteristic(RBL_WRITE_CHAR)
            controller = 'redbearlab'
          } catch (rblErr) {
            // Don't leave a GATT link open to a device we cannot drive.
            device.gatt?.disconnect()
            // A user disconnect that landed during the fallback lookup is not
            // an error to surface; same reduced guard as above.
            if (this.userDisconnect || this.device !== device) return
            if (isAbsentRejection(nordicErr) && isAbsentRejection(rblErr)) {
              throw new Error(
                'This device exposes no known MoonBoard LED service — pick a MoonBoard LED ' +
                  'controller (a Nordic UART board or the original RedBearLab box).',
              )
            }
            // A named failure (link drop, permission) surfaces as itself.
            throw isAbsentRejection(nordicErr) ? rblErr : nordicErr
          }
        }
        // A disconnect — user or link — may have landed while the awaits above
        // were pending; committing now would resurrect a severed connection
        // (state 'connected' with no device). Bail out instead. `=== false`
        // (not `!connected`): the Bluefy shim may not implement `connected`.
        if (this.userDisconnect || this.device !== device || device.gatt?.connected === false) {
          device.gatt?.disconnect()
          return
        }
        const link = buildLink(characteristic, controller)
        this.link = link
        this.reconnectAttempt = 0
        this.setState('connected', device.name ?? 'MoonBoard')
        console.log(
          `[ble] connected: controller=${link.controller} write=${link.mode}` +
            (link.proven ? '' : ' (unproven)'),
        )
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
    //
    // Chrome also echoes the client's *own* gatt.disconnect() (a failed probe,
    // the connect timeout, a race-guard bail) back through this event — while
    // state is still 'connecting', or already 'disconnected'. The attempt that
    // issued it owns the retry, so only a drop from 'connected' restarts the
    // backoff; otherwise every failed attempt would reset the counter and a
    // retained box that connects but fails the probe would loop forever.
    const freshDrop = this.state === 'connected'
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
    this.link = null
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

  /**
   * ASCII-encode, split into ≤20-byte chunks, and send each with the link's
   * write mode, awaited sequentially. Awaiting each write is the web
   * equivalent of CoreBluetooth's flow-controlled queue (back-pressure); with
   * acknowledged writes it is a true ATT-level acknowledgement.
   */
  private async write(message: string): Promise<void> {
    const link = this.link
    if (!link || this.state !== 'connected') {
      throw new Error('Not connected')
    }
    if (!link.writers[link.mode]) throw new Error(NO_WRITE_METHOD)
    const bytes = asciiEncode(message)
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_LENGTH) {
      // slice() copies into a fresh ArrayBuffer, satisfying BufferSource.
      const chunk = bytes.slice(offset, offset + MAX_CHUNK_LENGTH)
      await this.writeChunk(link, chunk)
    }
  }

  /**
   * Write one chunk in the link's mode. A write can transiently reject (GATT
   * momentarily busy, a radio hiccup) even on a healthy connection, so retry
   * once in the same mode after a short beat; a genuine failure (disconnected,
   * out of range) rejects again and propagates. Log the swallowed first error —
   * otherwise a board that retries on every chunk looks perfectly healthy and
   * its flakiness leaves no trail.
   *
   * On an *unproven* link (RedBearLab with no usable properties) a second
   * acknowledged rejection triggers one retry without response. Whichever
   * attempt succeeds locks its mode for the link — one-way, and only after the
   * same-mode retry, so a single transient error can never lock the silent
   * mode. "Proven" means the browser accepted the write, not that the board
   * rendered it; only the hardware check can confirm the LEDs light.
   */
  private async writeChunk(link: Link, chunk: BufferSource): Promise<void> {
    const mode = link.mode
    try {
      await this.writeOnce(link, mode, chunk)
    } catch (err) {
      console.warn('[ble] write retry after transient failure:', describeBleError(err))
      await delay(RETRY_DELAY_MS)
      try {
        await this.writeOnce(link, mode, chunk)
      } catch (retryErr) {
        // Proven in the mode we just tried: nothing left to try. (An
        // interleaved send may have flipped and locked the link meanwhile —
        // then `link.mode` differs and this chunk follows the locked mode.)
        if (link.proven && link.mode === mode) throw retryErr
        console.warn(
          '[ble] acknowledged write rejected twice on an unproven link; retrying without response:',
          describeBleError(retryErr),
        )
        await this.writeOnce(link, 'without-response', chunk)
        this.lockMode(link, 'without-response')
        return
      }
    }
    this.lockMode(link, mode)
  }

  private writeOnce(link: Link, mode: WriteMode, chunk: BufferSource): Promise<void> {
    const writer = link.writers[mode]
    if (!writer) return Promise.reject(new Error(NO_WRITE_METHOD))
    return writer(chunk)
  }

  /** Lock a mode as proven — only while `link` is still the current link. */
  private lockMode(link: Link, mode: WriteMode) {
    if (link.proven || this.link !== link) return
    link.mode = mode
    link.proven = true
  }
}

function asciiEncode(message: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(message.length))
  for (let i = 0; i < message.length; i++) {
    bytes[i] = message.charCodeAt(i) & 0x7f
  }
  return bytes
}
