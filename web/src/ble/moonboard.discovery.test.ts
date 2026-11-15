import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NUS_SERVICE, RBL_SERVICE, RBL_WRITE_CHAR, RX_CHAR } from './moonboard'
import { getBleDiagnostics } from './bleDiagnostics'
import { setLabSettings } from './labSettings'
import { bleHarness, fakeStack, notFound } from '../test/fakeBleStack'

// The Nordic-then-RedBearLab probe with the lab on (plan R10, R14, AE14) and the
// reconnect bound that ships on both paths (R25).

const { newClient, connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

describe('MoonBoardClient dual-generation discovery (lab on)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setLabSettings({ enabled: true, chooser: 'both' })
  })
  afterEach(() => {
    vi.useRealTimers()
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
    expect(stack.gatt.disconnect).toHaveBeenCalled()

    await client.connect().catch(() => {})
    expect(stack.requestDevice).toHaveBeenCalledTimes(2)
  })

  it('reports a link drop during the probe as the network error, not as no-known-service', async () => {
    const stack = fakeStack(undefined, { nordic: 'absent', redbearlab: 'absent' })
    stack.server.getPrimaryService.mockImplementation(async () => {
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
    await vi.advanceTimersByTimeAsync(0)
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
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection()
    server.getPrimaryService.mockRejectedValue(notFound('Services'))

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await expect(client.connect()).rejects.toThrow(/no known MoonBoard LED service/i)
    expect(client.state).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gatt.connect).toHaveBeenCalledTimes(2)
    expect(client.state).toBe('disconnected')

    await client.connect().catch(() => {})
    expect(requestDevice).toHaveBeenCalledTimes(2)
  })

  for (const disconnectEvent of ['sync', 'async'] as const) {
    it(`bounds the auto-reconnect to four attempts when the probe keeps failing and the disconnect echoes (${disconnectEvent})`, async () => {
      // Covers AE14 (lab on). Chrome echoes the client's own gatt.disconnect() as a
      // disconnect event — as a later task in practice, synchronously in the worst
      // case; before R25 that reset the backoff and looped ~120×/min.
      const { client, device, gatt, server } = await connectedClient(undefined, { disconnectEvent })
      server.getPrimaryService.mockRejectedValue(notFound('Services'))
      device.dropConnection()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.state).toBe('disconnected')
      expect(gatt.connect).toHaveBeenCalledTimes(5)
    })
  }

  it('bounds the auto-reconnect with the lab off when the connect timeout is the echo source', async () => {
    // Covers AE14 (lab off). Today's path never calls gatt.disconnect() from a lookup,
    // so the 10 s connect timeout is the only echo source there.
    setLabSettings({ enabled: false })
    const { client, device, gatt, server } = await connectedClient(undefined, {
      minimal: true,
      disconnectEvent: 'sync',
    })
    server.getPrimaryService.mockReturnValue(new Promise(() => {}))
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.state).toBe('disconnected')
    expect(gatt.connect).toHaveBeenCalledTimes(5)
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

  it('keeps the lab snapshot taken at connect for a silent reconnect, even if the store changed', async () => {
    const { client, device, reads } = await connectedClient()
    expect(reads.properties).toBe(1)
    setLabSettings({ enabled: false })
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(reads.properties).toBe(2) // still the lab path: properties read again
  })

  it('a lab-off attempt stays lab-off across a silent reconnect even if the lab is switched on meanwhile', async () => {
    setLabSettings({ enabled: false })
    const { client, device, reads } = await connectedClient(undefined, { minimal: true })
    setLabSettings({ enabled: true, chooser: 'both' })
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(reads.properties).toBe(0)
  })

  it('after an explicit disconnect, a different board generation is resolved on the next connect', async () => {
    const first = await connectedClient(undefined, { nordic: 'absent', redbearlab: 'present' })
    expect(first.client.controller).toBe('redbearlab')
    first.client.disconnect()
    expect(first.client.controller).toBeNull()

    const second = fakeStack()
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

  it('the connect timeout wraps a hung RedBearLab lookup and the diagnostics name the pending step', async () => {
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
    const timeout = getBleDiagnostics().events.find((e) => e.kind === 'connect-timeout')
    expect(timeout?.detail).toMatch(/redbearlab/i)
  })

  it('records the probe, the properties, the writers, and the link for a RedBearLab box', async () => {
    const { client } = await connectedClient(undefined, {
      nordic: 'absent',
      redbearlab: 'present',
      properties: { write: true, writeWithoutResponse: false },
    })
    expect(client.writeMode).toBe('with-response')
    const events = getBleDiagnostics().events.map((e) => `${e.kind} ${e.detail ?? ''}`)
    expect(events.some((e) => e.startsWith('probe nordic-uart failed') && e.includes('NotFoundError'))).toBe(true)
    expect(events.some((e) => e.startsWith('probe redbearlab ok'))).toBe(true)
    expect(events.some((e) => e.startsWith('properties') && e.includes('write=true'))).toBe(true)
    expect(events.some((e) => e.startsWith('writers') && e.includes('with'))).toBe(true)
    expect(events.some((e) => e.startsWith('link') && e.includes('mode=with-response'))).toBe(true)
    const link = getBleDiagnostics().link
    expect(link?.controller).toBe('redbearlab')
    expect(link?.writeMode).toBe('with-response')
    expect(link?.properties).toEqual({ write: true, writeWithoutResponse: false, notify: false, present: true })
    expect(link?.writers).toEqual(['with', 'without'])
  })

  it('marks absent properties on a thin shim and records user vs link disconnects', async () => {
    const { client, device } = await connectedClient(undefined, { properties: null })
    expect(getBleDiagnostics().link?.properties).toEqual({
      write: false,
      writeWithoutResponse: false,
      notify: false,
      present: false,
    })
    device.dropConnection()
    expect(getBleDiagnostics().link).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    client.disconnect()
    const kinds = getBleDiagnostics().events.map((e) => `${e.kind} ${e.detail ?? ''}`)
    expect(kinds.some((k) => k.startsWith('disconnected link'))).toBe(true)
    expect(kinds.some((k) => k.startsWith('disconnected user'))).toBe(true)
    expect(kinds.some((k) => k.startsWith('reconnect'))).toBe(true)
  })
})

describe('MoonBoardClient connect-failure diagnostics (both paths)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const [label, enabled] of [
    ['lab off', false],
    ['lab on', true],
  ] as const) {
    it(`records exactly one connect-failed event when gatt.connect rejects on a user tap (${label})`, async () => {
      setLabSettings({ enabled, chooser: 'both' })
      const stack = fakeStack(undefined, enabled ? {} : { minimal: true })
      stack.gatt.connect.mockRejectedValueOnce(
        new DOMException('Connection failed for unknown reason.', 'NetworkError'),
      )
      const client = newClient()
      await expect(client.connect()).rejects.toThrow(/Connection failed/)
      const failed = getBleDiagnostics().events.filter((e) => e.kind === 'connect-failed')
      expect(failed).toHaveLength(1)
      expect(failed[0]!.detail).toContain('NetworkError')
      expect(client.state).toBe('disconnected')
    })
  }

  it('records a failed lab-off lookup as a connect-failed event, once', async () => {
    const stack = fakeStack(undefined, { minimal: true, nordic: 'absent' })
    const client = newClient()
    await expect(client.connect()).rejects.toThrow()
    const kinds = getBleDiagnostics().events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'connect-failed')).toHaveLength(1)
    expect(kinds).not.toContain('reconnect-failed')
    expect(stack.gatt.connect).toHaveBeenCalledTimes(1)
  })

  it('a retained-device tap that fails records connect-failed, not reconnect-failed', async () => {
    const { client, device, gatt, requestDevice } = await connectedClient(undefined, { minimal: true })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    device.dropConnection() // hidden page: no silent reconnect is scheduled
    gatt.connect.mockRejectedValueOnce(new DOMException('Connection failed.', 'NetworkError'))
    await expect(client.connect()).rejects.toThrow(/Connection failed/)
    const kinds = getBleDiagnostics().events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'connect-failed')).toHaveLength(1)
    expect(kinds).not.toContain('reconnect-failed')
    expect(requestDevice).toHaveBeenCalledTimes(1) // retained path, no chooser
  })

  it('a user disconnect with no device records nothing', async () => {
    const client = newClient()
    client.disconnect()
    expect(getBleDiagnostics().events).toEqual([])
  })
})
