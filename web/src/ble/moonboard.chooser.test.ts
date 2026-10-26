import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NUS_SERVICE, RBL_SERVICE, requestDeviceOptionsFor } from './moonboard'
import { getBleDiagnostics } from './bleDiagnostics'
import { setLabSettings } from './labSettings'
import { bleHarness, fakeStack } from '../test/fakeBleStack'

// The lab's picker modes (plan R9, AE4, AE5) and the connect-start / device diagnostics
// the client records on every path (R16).

const { newClient, connectedClient, cleanupBleEnv } = bleHarness()

afterEach(cleanupBleEnv)

const nordicLiteral = { filters: [{ services: [NUS_SERVICE] }] }

describe('requestDeviceOptionsFor', () => {
  it('builds the both-generations request: three OR\'d filters and both optional services', () => {
    expect(requestDeviceOptionsFor('both')).toEqual({
      filters: [{ services: [NUS_SERVICE] }, { services: [RBL_SERVICE] }, { namePrefix: 'MoonBoard' }],
      optionalServices: [NUS_SERVICE, RBL_SERVICE],
    })
  })

  it('builds the any-device request without a filters key', () => {
    const options = requestDeviceOptionsFor('any')
    expect(options).toEqual({ acceptAllDevices: true, optionalServices: [NUS_SERVICE, RBL_SERVICE] })
    expect('filters' in options).toBe(false)
  })

  it('builds the Nordic-only request as today\'s literal', () => {
    expect(requestDeviceOptionsFor('nordic')).toEqual(nordicLiteral)
  })

  it('returns a fresh, unfrozen object on every call', () => {
    const a = requestDeviceOptionsFor('both')
    const b = requestDeviceOptionsFor('both')
    expect(a).not.toBe(b)
    expect(Object.isFrozen(a)).toBe(false)
    expect(Object.isFrozen(a.filters)).toBe(false)
  })
})

describe('MoonBoardClient chooser with the lab on', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes the both-generations options when the chooser is "both"', async () => {
    setLabSettings({ enabled: true, chooser: 'both' })
    const { requestDevice } = await connectedClient()
    expect(requestDevice).toHaveBeenCalledWith(requestDeviceOptionsFor('both'))
    expect(Object.isFrozen(requestDevice.mock.calls[0]![0])).toBe(false)
  })

  it('passes the any-device options when the chooser is "any"', async () => {
    setLabSettings({ enabled: true, chooser: 'any' })
    const { requestDevice } = await connectedClient()
    const options = requestDevice.mock.calls[0]![0] as Record<string, unknown>
    expect(options).toEqual({ acceptAllDevices: true, optionalServices: [NUS_SERVICE, RBL_SERVICE] })
    expect('filters' in options).toBe(false)
  })

  it('passes today\'s literal when the chooser is "nordic"', async () => {
    setLabSettings({ enabled: true, chooser: 'nordic' })
    const { requestDevice } = await connectedClient()
    expect(requestDevice.mock.calls[0]![0]).toEqual(nordicLiteral)
  })

  it('hands two consecutive chooser calls distinct option objects', async () => {
    setLabSettings({ enabled: true, chooser: 'both' })
    const { client, requestDevice } = await connectedClient()
    client.disconnect()
    fakeStack() // a new board; the first stack's requestDevice mock is replaced
    await client.connect()
    const second = (navigator as unknown as { bluetooth: { requestDevice: ReturnType<typeof vi.fn> } })
      .bluetooth.requestDevice
    expect(requestDevice).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(requestDevice.mock.calls[0]![0]).not.toBe(second.mock.calls[0]![0])
  })

  it('reconnects a retained device without the chooser, whatever the picker mode', async () => {
    setLabSettings({ enabled: true, chooser: 'any' })
    const { client, device, requestDevice } = await connectedClient()
    device.dropConnection()
    await vi.advanceTimersByTimeAsync(500)
    expect(client.state).toBe('connected')
    expect(requestDevice).toHaveBeenCalledTimes(1)
  })
})

describe('MoonBoardClient connect diagnostics', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('records connect start with the picker mode and the chosen device name', async () => {
    setLabSettings({ enabled: true, chooser: 'both' })
    await connectedClient(undefined, { name: 'MoonBoard A' })
    const kinds = getBleDiagnostics().events.map((e) => `${e.kind} ${e.detail ?? ''}`)
    expect(kinds.some((k) => k.startsWith('connect') && k.includes('both'))).toBe(true)
    expect(kinds.some((k) => k.startsWith('device') && k.includes('MoonBoard A'))).toBe(true)
  })

  it('records connect start and the device name with the lab off too, without the id', async () => {
    const { reads } = await connectedClient(undefined, { minimal: true, name: 'MB' })
    const events = getBleDiagnostics().events
    expect(events.some((e) => e.kind === 'connect' && (e.detail ?? '').includes('lab=off'))).toBe(true)
    expect(events.some((e) => e.kind === 'device' && (e.detail ?? '').includes('MB'))).toBe(true)
    expect(reads.id).toBe(0)
  })

  it('records the device id prefix only with the lab on', async () => {
    setLabSettings({ enabled: true })
    const { reads } = await connectedClient()
    expect(reads.id).toBe(1)
    const device = getBleDiagnostics().events.find((e) => e.kind === 'device')
    expect(device?.detail).toContain('fake-dev')
  })

  it('records a bare numeric chooser rejection exactly once, with its type and value', async () => {
    setLabSettings({ enabled: true })
    const stack = fakeStack()
    stack.requestDevice.mockRejectedValueOnce(2)
    const client = newClient()
    await expect(client.connect()).rejects.toBe(2)
    const rejections = getBleDiagnostics().events.filter((e) => e.kind === 'requestDevice-rejected')
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.detail).toContain('number')
    expect(rejections[0]!.detail).toContain('2')
  })
})
