// Fake Web Bluetooth stack for the MoonBoardClient suites (src/ble/moonboard*.test.ts).
//
// A device whose gatt tracks `connected`, dispatches gattserverdisconnected to
// registered listeners, and resolves a characteristic whose write is `write` —
// so connect/reconnect/send can run without hardware. `getPrimaryService` is
// UUID-aware: by default only the Nordic UART service resolves; `opts` selects
// which controller generation the fake board exposes, how a missing lookup
// rejects, how gatt.disconnect() echoes back as an event, and what the
// characteristic looks like (properties, which write methods). `minimal`
// reproduces the shape the pre-lab tests used (only `writeValueWithoutResponse`,
// no properties), and the `reads` counters let a suite assert that the lab-off
// path never touches `characteristic.properties` or `device.id`.

import { vi } from 'vitest'
import { MoonBoardClient, NUS_SERVICE, RBL_SERVICE } from '../ble/moonboard'
import { resetBleDiagnostics } from '../ble/bleDiagnostics'

export type WriteFn = (chunk: BufferSource) => Promise<void>

export interface FakeProperties {
  write?: boolean
  writeWithoutResponse?: boolean
  notify?: boolean
}

export interface StackOptions {
  /** Which services the fake board exposes. Default: Nordic UART only. */
  nordic?: 'present' | 'absent' | 'characteristic-missing'
  redbearlab?: 'present' | 'absent'
  /** Rejection value for an absent lookup. Default: a NotFoundError DOMException. */
  rejectWith?: { nordic?: unknown; redbearlab?: unknown }
  /** Characteristic `properties`; `null` makes the getter return undefined (thin shim). */
  properties?: FakeProperties | null
  /** Which write methods the characteristic exposes. Default: both split methods. */
  methods?: Array<'with' | 'without' | 'legacy'>
  /** Separate implementation for writeValueWithResponse (defaults to `write`). */
  writeWithResponse?: WriteFn
  /**
   * Whether the client's own gatt.disconnect() echoes back as a
   * gattserverdisconnected event, as Chrome does: synchronously inside the
   * call, or as a later task. Default: no echo (the pre-existing fake shape).
   */
  disconnectEvent?: 'none' | 'sync' | 'async'
  /** Today's pre-lab fake: only `writeValueWithoutResponse`, properties undefined. */
  minimal?: boolean
  /** Advertised device name. Default 'MB'. */
  name?: string
}

export function notFound(what: string) {
  return new DOMException(`No ${what} matching UUID found.`, 'NotFoundError')
}

/**
 * Holds whose message is exactly 45 bytes ('l#' + 11 tokens + '#'), so a send splits
 * into 20 + 20 + 5 — three chunks, which makes ordering and the per-chunk retry visible.
 */
export const THREE_CHUNK_HOLDS = [
  { col: 0, row: 1, type: 'start' as const }, // S0
  ...[1, 2, 3, 4, 5, 6].map((row) => ({ col: 2, row, type: 'right' as const })), // R24…R29
  { col: 4, row: 1, type: 'right' as const }, // R48
  { col: 4, row: 2, type: 'right' as const }, // R49
  { col: 6, row: 1, type: 'right' as const }, // R72
  { col: 8, row: 1, type: 'right' as const }, // R96
]

export function fakeStack(write: WriteFn = async () => {}, opts: StackOptions = {}) {
  const nordic = opts.nordic ?? 'present'
  const redbearlab = opts.redbearlab ?? 'absent'
  const methods = opts.minimal ? ['without'] : (opts.methods ?? ['with', 'without'])
  const reads = { properties: 0, id: 0 }
  const propertiesValue: FakeProperties | undefined =
    opts.minimal || opts.properties === null
      ? undefined
      : (opts.properties ??
        (redbearlab === 'present' && nordic !== 'present'
          ? { write: true, writeWithoutResponse: false }
          : { write: false, writeWithoutResponse: true }))
  const characteristic: {
    readonly properties: FakeProperties | undefined
    writeValueWithoutResponse: ReturnType<typeof vi.fn<WriteFn>>
    writeValueWithResponse: ReturnType<typeof vi.fn<WriteFn>>
    writeValue: ReturnType<typeof vi.fn<WriteFn>>
  } = {
    get properties() {
      reads.properties += 1
      return propertiesValue
    },
    writeValueWithoutResponse: vi.fn<WriteFn>(write),
    writeValueWithResponse: vi.fn<WriteFn>(opts.writeWithResponse ?? write),
    writeValue: vi.fn<WriteFn>(write),
  }
  const partial = characteristic as Partial<typeof characteristic>
  if (!methods.includes('without')) delete partial.writeValueWithoutResponse
  if (!methods.includes('with')) delete partial.writeValueWithResponse
  if (!methods.includes('legacy')) delete partial.writeValue
  const service = { getCharacteristic: vi.fn().mockResolvedValue(characteristic) }
  const nordicService = {
    getCharacteristic: vi.fn(async (uuid: string) => {
      if (nordic === 'characteristic-missing') throw notFound(`Characteristics ${uuid}`)
      return characteristic
    }),
  }
  const server = {
    getPrimaryService: vi.fn(async (uuid: string) => {
      if (uuid === NUS_SERVICE && nordic !== 'absent') return nordicService
      if (uuid === RBL_SERVICE && redbearlab === 'present') return service
      const which = uuid === NUS_SERVICE ? 'nordic' : 'redbearlab'
      throw opts.rejectWith?.[which] ?? notFound(`Services ${uuid}`)
    }),
  }
  const listeners = new Set<() => void>()
  const fire = () => {
    for (const fn of [...listeners]) fn()
  }
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      gatt.connected = true
      return server
    }),
    disconnect: vi.fn(() => {
      const wasConnected = gatt.connected
      gatt.connected = false
      if (!wasConnected) return
      if (opts.disconnectEvent === 'sync') fire()
      else if (opts.disconnectEvent === 'async') setTimeout(fire, 0)
    }),
  }
  const device = {
    name: opts.name ?? 'MB',
    get id() {
      reads.id += 1
      return 'fake-device-id-0123456789'
    },
    gatt,
    addEventListener: vi.fn((_type: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
    // Simulate an unexpected link drop (out of range, OS reclaimed it).
    dropConnection() {
      gatt.connected = false
      fire()
    },
  }
  const requestDevice = vi.fn().mockResolvedValue(device)
  ;(navigator as unknown as { bluetooth: unknown }).bluetooth = { requestDevice }
  return { device, gatt, server, characteristic, requestDevice, reads }
}

/** Reset the lab settings (via the storage-event idiom) and the diagnostics buffer. */
export function resetLabStores() {
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage'))
  resetBleDiagnostics()
}

/**
 * Per-file client registry: every client made through `newClient` /
 * `connectedClient` is disposed by `cleanupBleEnv()` in the file's afterEach,
 * which also restores the document visibility, removes the fake bluetooth, and
 * resets the lab stores.
 */
export function bleHarness() {
  const clients: MoonBoardClient[] = []

  function newClient(): MoonBoardClient {
    const client = new MoonBoardClient()
    clients.push(client)
    return client
  }

  async function connectedClient(write?: WriteFn, opts?: StackOptions) {
    const stack = fakeStack(write, opts)
    const client = newClient()
    await client.connect()
    return { client, ...stack }
  }

  function cleanupBleEnv() {
    for (const client of clients.splice(0)) client.dispose()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    delete (navigator as unknown as { bluetooth?: unknown }).bluetooth
    vi.restoreAllMocks()
    resetLabStores()
  }

  return { newClient, connectedClient, cleanupBleEnv }
}

export function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** The ASCII text of a written chunk. */
export function decodeChunk(chunk: BufferSource): string {
  const view = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : new Uint8Array(chunk.buffer)
  return String.fromCharCode(...view)
}

/** The chunks a write mock received, in order, as ASCII text. */
export function chunksOf(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map(([chunk]) => decodeChunk(chunk as BufferSource))
}
