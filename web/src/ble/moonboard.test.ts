import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, describeBleError, MoonBoardClient } from './moonboard'

// Fake Web Bluetooth stack: a device whose gatt tracks `connected`, dispatches
// gattserverdisconnected to registered listeners, and resolves a characteristic
// whose write is `write` — so connect/reconnect/send can run without hardware.
function fakeStack(write: (chunk: BufferSource) => Promise<void> = async () => {}) {
  const characteristic = { writeValueWithoutResponse: vi.fn(write) }
  const service = { getCharacteristic: vi.fn().mockResolvedValue(characteristic) }
  const server = { getPrimaryService: vi.fn().mockResolvedValue(service) }
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
  return { device, gatt, characteristic, requestDevice }
}

const clients: MoonBoardClient[] = []

function newClient(): MoonBoardClient {
  const client = new MoonBoardClient()
  clients.push(client)
  return client
}

async function connectedClient(write?: (chunk: BufferSource) => Promise<void>) {
  const stack = fakeStack(write)
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
