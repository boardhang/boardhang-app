import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NUS_SERVICE, RBL_SERVICE, RBL_WRITE_CHAR, REQUEST_DEVICE_OPTIONS, RX_CHAR } from './moonboard'
import { bleHarness, fakeStack, notFound } from '../test/fakeBleStack'

// The dual-generation chooser and the Nordic-then-RedBearLab probe
// (plan U1: R1-R4, R10; AE1-AE3, AE7, AE8).

const { newClient, connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

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
    expect(stack.gatt.disconnect).toHaveBeenCalled()

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

  it('surfaces a named error from the RedBearLab lookup as itself when Nordic was merely absent', async () => {
    fakeStack(undefined, {
      nordic: 'absent',
      redbearlab: 'absent',
      rejectWith: {
        redbearlab: new DOMException('Origin is not allowed to access the service.', 'SecurityError'),
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

  it('disconnect() during a RedBearLab lookup that then rejects bails silently, not with an error', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'absent' })
    let rejectRbl!: (err: unknown) => void
    stack.server.getPrimaryService.mockImplementation((uuid: string) => {
      if (uuid === NUS_SERVICE) return Promise.reject(notFound('Services'))
      return new Promise((_resolve, reject) => {
        rejectRbl = reject
      })
    })
    const client = newClient()
    const attempt = client.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(stack.server.getPrimaryService).toHaveBeenCalledTimes(2)

    client.disconnect()
    rejectRbl(notFound('Services'))
    await expect(attempt).resolves.toBeUndefined()
    expect(client.state).toBe('disconnected')
    expect(client.controller).toBeNull()
  })

  it('a probe failure on a retained device via a user tap drops it with no dangling reconnect', async () => {
    const { client, device, gatt, server, requestDevice } = await connectedClient(undefined, {
      disconnectEvent: 'sync',
    })
    // Drop while hidden so no auto-reconnect fires before the user taps.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection()
    server.getPrimaryService.mockRejectedValue(notFound('Services'))

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await expect(client.connect()).rejects.toThrow(/no known MoonBoard LED service/i)
    expect(client.state).toBe('disconnected')
    // The echoed disconnect must not have armed a chooser-free retry on a dropped device.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gatt.connect).toHaveBeenCalledTimes(2)
    expect(client.state).toBe('disconnected')

    await client.connect().catch(() => {})
    expect(requestDevice).toHaveBeenCalledTimes(2)
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
