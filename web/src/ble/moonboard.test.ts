import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMessage,
  describeBleError,
  MoonBoardClient,
  NUS_SERVICE,
  RBL_SERVICE,
  RBL_WRITE_CHAR,
  REQUEST_DEVICE_OPTIONS,
  RX_CHAR,
} from './moonboard'

// Fake Web Bluetooth stack: a device whose gatt tracks `connected`, dispatches
// gattserverdisconnected to registered listeners, and resolves a characteristic
// whose write is `write` — so connect/reconnect/send can run without hardware.
//
// `getPrimaryService` is UUID-aware: by default only the Nordic UART service
// resolves (the shape every pre-existing test assumes); `opts` selects which
// controller generation the fake board exposes, how a missing lookup rejects,
// and what the characteristic looks like (properties, which write methods).
type WriteFn = (chunk: BufferSource) => Promise<void>

interface FakeProperties {
  write?: boolean
  writeWithoutResponse?: boolean
}

interface StackOptions {
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
}

function notFound(what: string) {
  return new DOMException(`No ${what} matching UUID found.`, 'NotFoundError')
}

function fakeStack(write: WriteFn = async () => {}, opts: StackOptions = {}) {
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
  if (!methods.includes('without')) delete (characteristic as Partial<typeof characteristic>).writeValueWithoutResponse
  if (!methods.includes('with')) delete (characteristic as Partial<typeof characteristic>).writeValueWithResponse
  if (!methods.includes('legacy')) delete (characteristic as Partial<typeof characteristic>).writeValue
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
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      gatt.connected = true
      return server
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false
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
      for (const fn of [...listeners]) fn()
    },
  }
  const requestDevice = vi.fn().mockResolvedValue(device)
  ;(navigator as unknown as { bluetooth: unknown }).bluetooth = { requestDevice }
  return { device, gatt, server, characteristic, requestDevice }
}

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

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  delete (navigator as unknown as { bluetooth?: unknown }).bluetooth
  vi.restoreAllMocks()
})

describe('MoonBoardClient.send retry', () => {
  const opts = { rows: 12, flipped: false, showBeta: true }
  const holds = [{ col: 0, row: 1, type: 'start' as const }]

  it('retries a transient write failure once and succeeds', async () => {
    let calls = 0
    const { client, characteristic } = await connectedClient(async () => {
      calls += 1
      if (calls === 1) throw new Error('GATT busy')
    })
    await expect(client.send(holds, opts)).resolves.toBeUndefined()
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
  })

  it('propagates when the write fails on both attempts', async () => {
    const { client, characteristic } = await connectedClient(async () => {
      throw new Error('GATT disconnected')
    })
    await expect(client.send(holds, opts)).rejects.toThrow('GATT disconnected')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
  })
})

describe('MoonBoardClient auto-reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('silently reconnects after an unexpected disconnect, without the chooser', async () => {
    const { client, device, gatt, requestDevice } = await connectedClient()
    device.dropConnection()
    expect(client.state).toBe('disconnected')

    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(gatt.connect).toHaveBeenCalledTimes(2)
    expect(requestDevice).toHaveBeenCalledTimes(1)
  })

  it('backs off across attempts and gives up, staying disconnected', async () => {
    const { client, device, gatt } = await connectedClient()
    gatt.connect.mockRejectedValue(new Error('out of range'))
    device.dropConnection()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.state).toBe('disconnected')
    // 1 initial connect + 4 backoff attempts (500ms/1s/2s/4s), then no more.
    expect(gatt.connect).toHaveBeenCalledTimes(5)
  })

  it('does not auto-reconnect after an explicit disconnect()', async () => {
    const { client, gatt } = await connectedClient()
    client.disconnect()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.state).toBe('disconnected')
    expect(gatt.connect).toHaveBeenCalledTimes(1)
  })

  it('does not retry while hidden, and reconnects on returning to visible', async () => {
    const { client, device, gatt } = await connectedClient()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(gatt.connect).toHaveBeenCalledTimes(1)
    expect(client.state).toBe('disconnected')

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.state).toBe('connected')
    expect(gatt.connect).toHaveBeenCalledTimes(2)
  })

  it('detects a link that died while frozen (no disconnect event) on visibilitychange', async () => {
    const { client, gatt } = await connectedClient()
    // Android froze the page and dropped the link without delivering
    // gattserverdisconnected: gatt says dead while our state still says connected.
    gatt.connected = false
    expect(client.state).toBe('connected')

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.state).toBe('connected')
    expect(gatt.connect).toHaveBeenCalledTimes(2)
  })
})

describe('MoonBoardClient in-flight races', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('disconnect() during an in-flight reconnect keeps the client disconnected', async () => {
    const { client, device, characteristic } = await connectedClient()
    // Hold the reconnect's characteristic resolution open across disconnect().
    let releaseCharacteristic!: () => void
    const gate = new Promise<typeof characteristic>((resolve) => {
      releaseCharacteristic = () => resolve(characteristic)
    })
    const service = { getCharacteristic: vi.fn().mockReturnValue(gate) }
    device.gatt.connect.mockResolvedValue({ getPrimaryService: vi.fn().mockResolvedValue(service) })

    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500) // reconnect attempt now awaiting the gate
    expect(client.state).toBe('connecting')

    client.disconnect()
    expect(client.state).toBe('disconnected')
    releaseCharacteristic()
    await vi.advanceTimersByTimeAsync(0)
    // The late establish() resolution must not resurrect the connection.
    expect(client.state).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.state).toBe('disconnected')
  })

  it('a link drop mid-establish does not commit a stale connected state', async () => {
    const { client, device, gatt, characteristic } = await connectedClient()
    let releaseCharacteristic!: () => void
    const gate = new Promise<typeof characteristic>((resolve) => {
      releaseCharacteristic = () => resolve(characteristic)
    })
    const service = { getCharacteristic: vi.fn().mockReturnValue(gate) }
    gatt.connect.mockResolvedValue({ getPrimaryService: vi.fn().mockResolvedValue(service) })

    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500) // reconnect awaiting the gate
    device.dropConnection() // link dies again mid-establish
    releaseCharacteristic()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.state).not.toBe('connected')
  })

  it('connect() joining an in-flight reconnect shares the one attempt', async () => {
    const { client, device, gatt, characteristic, requestDevice } = await connectedClient()
    // Hold the reconnect's establish() open so connect() lands while it's in flight.
    let releaseCharacteristic!: () => void
    const gate = new Promise<typeof characteristic>((resolve) => {
      releaseCharacteristic = () => resolve(characteristic)
    })
    const service = { getCharacteristic: vi.fn().mockReturnValue(gate) }
    gatt.connect.mockClear()
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return { getPrimaryService: vi.fn().mockResolvedValue(service) }
    })

    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500) // reconnect's establish() now awaiting the gate
    expect(client.state).toBe('connecting')

    const joined = client.connect() // joins the in-flight attempt, does not start a new one
    releaseCharacteristic()
    await joined
    expect(client.state).toBe('connected')
    expect(requestDevice).toHaveBeenCalledTimes(1) // no chooser
    expect(gatt.connect).toHaveBeenCalledTimes(1) // single GATT connect shared
  })

  it('connect() joining a failing auto attempt drops the device (next tap choosers)', async () => {
    const { client, device, gatt, requestDevice } = await connectedClient()
    let failAttempt!: (err: Error) => void
    gatt.connect.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failAttempt = reject
      }),
    )
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500) // auto attempt in flight
    const userTap = client.connect() // joins the in-flight attempt
    failAttempt(new Error('out of range'))
    await expect(userTap).rejects.toThrow('out of range')

    await client.connect()
    expect(requestDevice).toHaveBeenCalledTimes(2)
  })

  it('a hung gatt.connect() times out instead of wedging connecting forever', async () => {
    const stack = fakeStack()
    stack.gatt.connect.mockReturnValue(new Promise(() => {})) // never settles
    const client = newClient()
    const attempt = client.connect()
    attempt.catch(() => {}) // assert via expect below; avoid unhandled rejection
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(attempt).rejects.toThrow(/timed out/)
    expect(client.state).toBe('disconnected')

    // The wedge is gone: a later connect() runs a fresh attempt.
    stack.gatt.connect.mockRestore?.()
    stack.gatt.connect.mockImplementation(async () => {
      stack.gatt.connected = true
      return { getPrimaryService: vi.fn().mockResolvedValue({ getCharacteristic: vi.fn().mockResolvedValue(stack.characteristic) }) }
    })
    await client.connect()
    expect(client.state).toBe('connected')
  })
})

describe('MoonBoardClient.connect with a retained device', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips the chooser when a device is retained from a previous connection', async () => {
    const { client, device, gatt, requestDevice } = await connectedClient()
    // Drop while hidden so no auto-reconnect fires before the user taps.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection()

    await client.connect()
    expect(client.state).toBe('connected')
    expect(gatt.connect).toHaveBeenCalledTimes(2)
    expect(requestDevice).toHaveBeenCalledTimes(1)
  })

  it('drops an unreachable retained device so the next connect() opens the chooser', async () => {
    const { client, device, gatt, requestDevice } = await connectedClient()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection()

    gatt.connect.mockRejectedValueOnce(new Error('out of range'))
    await expect(client.connect()).rejects.toThrow('out of range')
    expect(client.state).toBe('disconnected')

    await client.connect()
    expect(requestDevice).toHaveBeenCalledTimes(2)
    expect(client.state).toBe('connected')
  })
})

describe('buildMessage', () => {
  const opts = { rows: 12, flipped: false, showBeta: true }

  it('encodes in-range holds as an l#…# token string', () => {
    expect(buildMessage([{ col: 0, row: 1, type: 'start' }], opts)).toBe('l#S0#')
  })

  it('throws a readable RangeError for an out-of-range hold (surfaces, not silent)', () => {
    // A finish hold at row 18 on a 12-row Mini board used to silently mis-light.
    const holds = [{ col: 9, row: 18, type: 'end' as const }]
    expect(() => buildMessage(holds, opts)).toThrow(RangeError)
    // The message reaches the user via describeBleError → must stay readable.
    try {
      buildMessage(holds, opts)
    } catch (err) {
      expect(describeBleError(err)).toMatch(/row 18/i)
    }
  })
})

describe('describeBleError', () => {
  it('passes through a readable Error message', () => {
    expect(describeBleError(new Error('GATT Server is disconnected'))).toBe(
      'GATT Server is disconnected',
    )
  })

  it('reads .message off a non-Error object (DOMException-like)', () => {
    expect(describeBleError({ name: 'NetworkError', message: 'Write failed' })).toBe('Write failed')
  })

  it('passes through a readable string rejection', () => {
    expect(describeBleError('Bluetooth is off')).toBe('Bluetooth is off')
  })

  it('preserves a localized (non-ASCII) message instead of the English fallback', () => {
    // A non-English system locale can surface a CJK/Cyrillic GATT message.
    expect(describeBleError(new Error('デバイスが見つかりません'))).toBe('デバイスが見つかりません')
    expect(describeBleError('Устройство не найдено')).toBe('Устройство не найдено')
  })

  it('falls back for a bare numeric code (the iOS Bluefy "2" case)', () => {
    // A rejection that String()s to "2" carries no letters → unactionable.
    expect(describeBleError(2)).toContain("Couldn't reach the board")
    expect(describeBleError(new Error('2'))).toContain("Couldn't reach the board")
    expect(describeBleError({ message: 2 })).toContain("Couldn't reach the board")
  })

  it('falls back for empty/nullish rejections', () => {
    expect(describeBleError(new Error(''))).toContain("Couldn't reach the board")
    expect(describeBleError(null)).toContain("Couldn't reach the board")
    expect(describeBleError(undefined)).toContain("Couldn't reach the board")
  })
})

// A 45-byte message: 'l#' + 11 tokens (one 2-char, ten 3-char) + '#'. Splits into
// 20 + 20 + 5 bytes — three chunks, so ordering and the retry-per-chunk rule are
// observable. Length is asserted in the suite that depends on it.
const threeChunkHolds = [
  { col: 0, row: 1, type: 'start' as const }, // S0
  ...[1, 2, 3, 4, 5, 6].map((row) => ({ col: 2, row, type: 'right' as const })), // R24…R29
  { col: 4, row: 1, type: 'right' as const }, // R48
  { col: 4, row: 2, type: 'right' as const }, // R49
  { col: 6, row: 1, type: 'right' as const }, // R72
  { col: 8, row: 1, type: 'right' as const }, // R96
]

function decode(chunk: BufferSource): string {
  const view = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : new Uint8Array(chunk.buffer)
  return String.fromCharCode(...view)
}

function chunksOf(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map(([chunk]) => decode(chunk as BufferSource))
}

describe('MoonBoardClient dual-generation discovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests the chooser with both service filters, the MoonBoard name prefix, and both optional services', async () => {
    const { client, requestDevice } = await connectedClient()
    expect(client.state).toBe('connected')
    expect(requestDevice).toHaveBeenCalledWith(REQUEST_DEVICE_OPTIONS)
    expect(REQUEST_DEVICE_OPTIONS.filters).toEqual([
      { services: [NUS_SERVICE] },
      { services: [RBL_SERVICE] },
      { namePrefix: 'MoonBoard' },
    ])
    expect(REQUEST_DEVICE_OPTIONS.optionalServices).toEqual([NUS_SERVICE, RBL_SERVICE])
    expect(Object.isFrozen(REQUEST_DEVICE_OPTIONS)).toBe(true)
  })

  it('resolves a Nordic UART board without ever asking for the RedBearLab service', async () => {
    const { client, server } = await connectedClient()
    expect(client.controller).toBe('nordic-uart')
    expect(server.getPrimaryService).toHaveBeenCalledTimes(1)
    expect(server.getPrimaryService).toHaveBeenCalledWith(NUS_SERVICE)
  })

  it('falls back to the RedBearLab service on a first-generation box', async () => {
    const { client, server } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
    })
    expect(client.state).toBe('connected')
    expect(client.controller).toBe('redbearlab')
    expect(server.getPrimaryService.mock.calls.map(([uuid]) => uuid)).toEqual([NUS_SERVICE, RBL_SERVICE])
    // The write characteristic was resolved from the RedBearLab service.
    const rblService = await server.getPrimaryService.mock.results[1]!.value
    expect(rblService.getCharacteristic).toHaveBeenCalledWith(RBL_WRITE_CHAR)
  })

  it('falls through on a Bluefy-shaped nameless rejection (bare number) of the Nordic lookup', async () => {
    const { client } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      rejectWith: { nordic: 2 },
    })
    expect(client.state).toBe('connected')
    expect(client.controller).toBe('redbearlab')
  })

  it('falls back when the Nordic service exists but its RX characteristic is missing', async () => {
    const { client, server } = await connectedClient(undefined, {
      nordic: 'characteristic-missing',
      redbearlab: 'present',
    })
    expect(client.controller).toBe('redbearlab')
    const nordicService = await server.getPrimaryService.mock.results[0]!.value
    expect(nordicService.getCharacteristic).toHaveBeenCalledWith(RX_CHAR)
  })

  it('rejects readably when neither service exists, and the next tap choosers again', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'absent' })
    const client = newClient()
    await expect(client.connect()).rejects.toThrow(/no known MoonBoard LED service/i)
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()
    // The GATT link to a device we cannot drive is not left open.
    expect(stack.gatt.disconnect).toHaveBeenCalled()

    // Device dropped: the next connect() opens the chooser again.
    await client.connect().catch(() => {})
    expect(stack.requestDevice).toHaveBeenCalledTimes(2)
  })

  it('reports a link drop during the probe as the network error, not as no-known-service', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'absent' })
    stack.server.getPrimaryService.mockImplementation(async () => {
      // Chrome drops gatt.connected before the lookup rejects.
      stack.gatt.connected = false
      throw new DOMException('GATT Server is disconnected. Cannot retrieve services.', 'NetworkError')
    })
    const client = newClient()
    await expect(client.connect()).rejects.toThrow(/GATT Server is disconnected/)
    expect(stack.server.getPrimaryService).toHaveBeenCalledTimes(2)
    expect(client.state).toBe('disconnected')

    await client.connect().catch(() => {})
    expect(stack.requestDevice).toHaveBeenCalledTimes(2)
  })

  it('surfaces a permission error from the Nordic lookup as itself', async () => {
    fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'absent',
      rejectWith: {
        nordic: new DOMException('Origin is not allowed to access the service.', 'SecurityError'),
      },
    })
    const client = newClient()
    await expect(client.connect()).rejects.toThrow(/not allowed to access/)
  })

  it('disconnect() during the Nordic lookup bails silently and never probes RedBearLab', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'present' })
    let rejectNordic!: (err: unknown) => void
    stack.server.getPrimaryService.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNordic = reject
        }),
    )
    const client = newClient()
    const attempt = client.connect()
    await vi.advanceTimersByTimeAsync(0) // now awaiting the gated Nordic lookup
    expect(client.state).toBe('connecting')

    client.disconnect()
    rejectNordic(notFound('Services'))
    await expect(attempt).resolves.toBeUndefined()
    expect(stack.server.getPrimaryService).toHaveBeenCalledTimes(1)
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.state).toBe('disconnected')
    expect(stack.gatt.connect).toHaveBeenCalledTimes(1)
  })

  it('disconnect() during the RedBearLab lookup does not resurrect the connection', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'present' })
    const rblService = { getCharacteristic: vi.fn().mockResolvedValue(stack.characteristic) }
    let releaseRbl!: () => void
    stack.server.getPrimaryService.mockImplementation((uuid: string) => {
      if (uuid === NUS_SERVICE) return Promise.reject(notFound('Services'))
      return new Promise((resolve) => {
        releaseRbl = () => resolve(rblService)
      })
    })
    const client = newClient()
    const attempt = client.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(stack.server.getPrimaryService).toHaveBeenCalledTimes(2)

    client.disconnect()
    releaseRbl()
    await attempt
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()
    expect(stack.gatt.disconnect).toHaveBeenCalled()
  })

  it('re-runs the probe on a chooser-free reconnect after an unexpected drop', async () => {
    const { client, device, server, requestDevice } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
    })
    device.dropConnection()
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()

    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.controller).toBe('redbearlab')
    expect(requestDevice).toHaveBeenCalledTimes(1)
    expect(server.getPrimaryService.mock.calls.map(([uuid]) => uuid)).toEqual([
      NUS_SERVICE,
      RBL_SERVICE,
      NUS_SERVICE,
      RBL_SERVICE,
    ])
  })

  it('after an explicit disconnect, a different board generation is resolved on the next connect', async () => {
    const first = await connectedClient(undefined, { nordic: 'absent', redbearlab: 'present' })
    expect(first.client.controller).toBe('redbearlab')
    first.client.disconnect()
    expect(first.client.controller).toBeNull()

    const second = fakeStack() // Nordic UART board now
    await first.client.connect()
    expect(first.requestDevice).toHaveBeenCalledTimes(1)
    expect(second.requestDevice).toHaveBeenCalledTimes(1)
    expect(first.client.controller).toBe('nordic-uart')
  })

  it('the connect timeout wraps a hung Nordic lookup and the RedBearLab lookup is never reached', async () => {
    const stack = fakeStack(undefined, { redbearlab: 'present' })
    stack.server.getPrimaryService.mockReturnValue(new Promise(() => {}))
    const client = newClient()
    const attempt = client.connect()
    attempt.catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(attempt).rejects.toThrow(/timed out/)
    expect(stack.server.getPrimaryService).toHaveBeenCalledTimes(1)
    expect(client.state).toBe('disconnected')
  })

  it('the connect timeout wraps a hung RedBearLab lookup', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'present' })
    stack.server.getPrimaryService.mockImplementation((uuid: string) =>
      uuid === NUS_SERVICE ? Promise.reject(notFound('Services')) : new Promise(() => {}),
    )
    const client = newClient()
    const attempt = client.connect()
    attempt.catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(attempt).rejects.toThrow(/timed out/)
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()
  })
})

describe('MoonBoardClient write mode', () => {
  const opts = { rows: 12, flipped: false, showBeta: true }
  const oneHold = [{ col: 0, row: 1, type: 'start' as const }]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Reject the first `n` calls with `err`, then succeed. */
  function rejectFirst(n: number, err: unknown = new Error('GATT operation failed')): WriteFn {
    let calls = 0
    return async () => {
      calls += 1
      if (calls <= n) throw err
    }
  }

  it('the three-chunk fixture is 45 bytes', () => {
    expect(buildMessage(threeChunkHolds, opts)).toHaveLength(45)
  })

  it('Nordic with writeWithoutResponse: three chunks of 20/20/5 without response, nothing with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: false, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('without-response')
    const chunks = chunksOf(characteristic.writeValueWithoutResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('Nordic with no properties (thin shim): without response, and the retry stays without response', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(1), { properties: null })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('Nordic reporting only plain write goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with write only: three chunks with response, in order, nothing without response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    const chunks = chunksOf(characteristic.writeValueWithResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5])
    expect(chunks.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with both write flags goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: true },
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with writeWithoutResponse only goes without response, known (same-mode retry)', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(2), {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    expect(client.writeMode).toBe('without-response')
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with no properties goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
    })
    await client.send(threeChunkHolds, opts)
    expect(client.writeMode).toBe('with-response')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('RedBearLab with properties that report neither flag goes with response', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: false },
    })
    await client.send(threeChunkHolds, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('unproven link: a transient rejection recovers in the acknowledged mode and locks it', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: rejectFirst(1, 2), // nameless, Bluefy-style
    })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()

    // Locked: a later double rejection is retried with response only and never flips.
    characteristic.writeValueWithResponse.mockImplementation(rejectFirst(2))
    const second = client.send(oneHold, opts)
    second.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(second).rejects.toThrow()
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(4)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('unproven link: two acknowledged rejections flip the chunk to without response, one-way', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: async () => {
        throw new DOMException('GATT Error: Not supported.', 'NotSupportedError')
      },
    })
    const sent = client.send(threeChunkHolds, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    // Chunk 1: with response twice (same-mode retry after the beat), then without response.
    const acked = chunksOf(characteristic.writeValueWithResponse)
    const unacked = chunksOf(characteristic.writeValueWithoutResponse)
    expect(acked).toEqual([unacked[0], unacked[0]])
    // Chunks 1–3 all landed without response, in order, message complete.
    expect(unacked.map((c) => c.length)).toEqual([20, 20, 5])
    expect(unacked.join('')).toBe(buildMessage(threeChunkHolds, opts))
    expect(client.writeMode).toBe('without-response')

    // A second message starts without response from the first chunk.
    await client.send(oneHold, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(4)
  })

  it('unproven link: when the flip also fails, send rejects and the link stays unproven with response', async () => {
    const { client, characteristic } = await connectedClient(
      async () => {
        throw new Error('write not permitted')
      },
      {
        nordic: 'absent',
        redbearlab: 'present',
        properties: null,
        writeWithResponse: async () => {
          throw new Error('write rejected')
        },
      },
    )
    const sent = client.send(threeChunkHolds, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('write not permitted')
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    expect(client.writeMode).toBe('with-response')

    // Still unproven: the next send starts with response again.
    characteristic.writeValueWithResponse.mockImplementation(async () => {})
    await client.send(oneHold, opts)
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(3)
    expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
  })

  it('locked by success: a later rejection on chunk 2 retries with response and never flips', async () => {
    let calls = 0
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      writeWithResponse: async () => {
        calls += 1
        if (calls >= 2) throw new Error('GATT operation failed')
      },
    })
    const sent = client.send(threeChunkHolds, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    // Chunk 1 ok, chunk 2 twice, chunk 3 never sent.
    const chunks = chunksOf(characteristic.writeValueWithResponse)
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 20])
    expect(chunks[1]).toBe(chunks[2])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('known RedBearLab link: a transient rejection is retried with response, mode unchanged', async () => {
    const { client, characteristic } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
      writeWithResponse: rejectFirst(1, new Error('GATT busy')),
    })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(characteristic.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
    expect(client.writeMode).toBe('with-response')
  })

  it('legacy writeValue when the split methods are missing; an unproven link retries once and never loops', async () => {
    const { client, characteristic } = await connectedClient(rejectFirst(99), {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null,
      methods: ['legacy'],
    })
    const sent = client.send(oneHold, opts)
    sent.catch(() => {})
    await vi.advanceTimersByTimeAsync(200)
    await expect(sent).rejects.toThrow('GATT operation failed')
    expect(characteristic.writeValue).toHaveBeenCalledTimes(2)

    characteristic.writeValue.mockImplementation(async () => {})
    await client.send(threeChunkHolds, opts)
    expect(chunksOf(characteristic.writeValue).slice(2).map((c) => c.length)).toEqual([20, 20, 5])
  })

  it('no write method at all: send rejects with a readable message', async () => {
    const { client } = await connectedClient(undefined, { methods: [] })
    let caught: unknown
    await client.send(oneHold, opts).catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(Error)
    expect(describeBleError(caught)).toMatch(/write/i)
    expect(describeBleError(caught)).not.toContain("Couldn't reach the board")
  })

  it('clear() on a RedBearLab box writes the single 3-byte l## chunk with the link mode', async () => {
    const { client, characteristic } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    await client.clear()
    expect(chunksOf(characteristic.writeValueWithResponse)).toEqual(['l##'])
    expect(characteristic.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('a stale link settling after a reconnect cannot touch the new link', async () => {
    let settleFirst!: (err: unknown) => void
    let calls = 0
    const {
      client,
      device,
      gatt,
      characteristic: oldChar,
    } = await connectedClient(async () => {}, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: null, // unproven, with response
      writeWithResponse: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<void>((_resolve, reject) => {
            settleFirst = reject
          })
        }
        return Promise.resolve()
      },
    })
    const sent = client.send(oneHold, opts)
    await vi.advanceTimersByTimeAsync(0) // first acknowledged write pending

    // Link drops; the reconnect resolves a *new* characteristic that is known without-response.
    const fresh = fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return fresh.server
    })
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.writeMode).toBe('without-response')

    // The old link's write now rejects, retries with response, and that retry succeeds:
    // the old record locks itself with-response — the new link must stay without-response.
    settleFirst(new Error('GATT operation failed'))
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(oldChar.writeValueWithResponse).toHaveBeenCalledTimes(2)
    expect(client.writeMode).toBe('without-response')
    await client.send(oneHold, opts)
    expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
    expect(fresh.characteristic.writeValueWithResponse).not.toHaveBeenCalled()
  })

  it('mode is re-derived from the new characteristic after a reconnect', async () => {
    const { client, device, gatt } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    expect(client.writeMode).toBe('with-response')

    const fresh = fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: false, writeWithoutResponse: true },
    })
    gatt.connect.mockImplementation(async () => {
      gatt.connected = true
      return fresh.server
    })
    device.dropConnection()
    expect(client.writeMode).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(client.writeMode).toBe('without-response')
    await client.send(oneHold, opts)
    expect(fresh.characteristic.writeValueWithoutResponse).toHaveBeenCalledTimes(1)
  })
})
