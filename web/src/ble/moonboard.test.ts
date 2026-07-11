import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMessage, describeBleError, MoonBoardClient } from './moonboard'

// Wire a MoonBoardClient to a fake Web Bluetooth stack whose characteristic write
// is `write`, so send()/writeWithRetry can be exercised without hardware.
async function connectedClient(write: (chunk: BufferSource) => Promise<void>) {
  const characteristic = { writeValueWithoutResponse: vi.fn(write) }
  const service = { getCharacteristic: vi.fn().mockResolvedValue(characteristic) }
  const server = { getPrimaryService: vi.fn().mockResolvedValue(service) }
  const device = {
    name: 'MB',
    gatt: { connect: vi.fn().mockResolvedValue(server) },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  ;(navigator as unknown as { bluetooth: unknown }).bluetooth = {
    requestDevice: vi.fn().mockResolvedValue(device),
  }
  const client = new MoonBoardClient()
  await client.connect()
  return { client, characteristic }
}

afterEach(() => {
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
