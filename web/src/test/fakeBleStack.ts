// Fake Web Bluetooth stack for the MoonBoardClient suites (src/ble/moonboard*.test.ts).
//
// A device whose gatt tracks `connected`, dispatches gattserverdisconnected to
// registered listeners, and resolves a characteristic whose write is `write` —
// so connect/reconnect/send can run without hardware. `getPrimaryService` is
// UUID-aware: by default only the Nordic UART service resolves; `opts` selects
// which controller generation the fake board exposes, how a missing lookup
// rejects, how gatt.disconnect() echoes back as an event, and what the
// characteristic looks like (properties, which write methods).

import { vi } from 'vitest'
import { MoonBoardClient, NUS_SERVICE, RBL_SERVICE } from '../ble/moonboard'

export type WriteFn = (chunk: BufferSource) => Promise<void>

export interface FakeProperties {
  write?: boolean
  writeWithoutResponse?: boolean
}

export interface StackOptions {
  /** Which services the fake board exposes. Default: Nordic UART only. */
  nordic?: 'present' | 'absent' | 'characteristic-missing'
  redbearlab?: 'present' | 'absent'
  /** Rejection value for an absent lookup. Default: a NotFoundError DOMException. */
  rejectWith?: { nordic?: unknown; redbearlab?: unknown }
  /** Characteristic `properties`; `null` omits the object entirely (thin shim). */
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
}

export function notFound(what: string) {
  return new DOMException(`No ${what} matching UUID found.`, 'NotFoundError')
}

export function fakeStack(write: WriteFn = async () => {}, opts: StackOptions = {}) {
  const nordic = opts.nordic ?? 'present'
  const redbearlab = opts.redbearlab ?? 'absent'
  const methods = opts.methods ?? ['with', 'without']
  const characteristic: {
    properties?: FakeProperties
    writeValueWithoutResponse: ReturnType<typeof vi.fn<WriteFn>>
    writeValueWithResponse: ReturnType<typeof vi.fn<WriteFn>>
    writeValue: ReturnType<typeof vi.fn<WriteFn>>
  } = {
    writeValueWithoutResponse: vi.fn<WriteFn>(write),
    writeValueWithResponse: vi.fn<WriteFn>(opts.writeWithResponse ?? write),
    writeValue: vi.fn<WriteFn>(write),
  }
  const partial = characteristic as Partial<typeof characteristic>
  if (!methods.includes('without')) delete partial.writeValueWithoutResponse
  if (!methods.includes('with')) delete partial.writeValueWithResponse
  if (!methods.includes('legacy')) delete partial.writeValue
  if (opts.properties !== null) {
    characteristic.properties =
      opts.properties ??
      (redbearlab === 'present' && nordic !== 'present'
        ? { write: true, writeWithoutResponse: false }
        : { write: false, writeWithoutResponse: true })
  }
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
    name: 'MB',
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
  return { device, gatt, server, characteristic, requestDevice }
}

/**
 * Per-file client registry: every client made through `newClient` /
 * `connectedClient` is disposed by `cleanupBleEnv()` in the file's afterEach,
 * which also restores the document visibility and removes the fake bluetooth.
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
