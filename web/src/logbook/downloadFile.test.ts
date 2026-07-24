import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFile } from './downloadFile'

describe('downloadFile', () => {
  beforeEach(() => {
    // Fake timers so the deferred URL.revokeObjectURL fires inside the test, before the URL
    // stub is torn down — not on a real timer after teardown.
    vi.useFakeTimers()
    // Default to a non-iOS UA so the anchor-download path runs unless a test opts into iOS.
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 })
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates an object URL from a typed Blob and triggers an anchor download', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadFile('logbook.csv', 'date,name\n', 'text/csv')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/csv')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('revokes the object URL after the click settles (no leak, no premature cancel)', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadFile('logbook.json', '{}', 'application/json')

    // Deferred, not synchronous: still pending immediately after the click.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('shares via the native sheet on iOS instead of an anchor download', async () => {
    const share = vi.fn((_data: { files: File[] }) => Promise.resolve())
    const canShare = vi.fn(() => true)
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
      share,
      canShare,
    })
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadFile('logbook.csv', 'date,name\n', 'text/csv')

    expect(share).toHaveBeenCalledTimes(1)
    const shared = share.mock.calls[0][0]
    expect(shared.files[0]).toBeInstanceOf(File)
    expect(shared.files[0].name).toBe('logbook.csv')
    // No anchor download fallback when the share succeeds.
    expect(click).not.toHaveBeenCalled()
  })

  it('treats a cancelled share sheet as done (no anchor fallback)', async () => {
    const share = vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError')))
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
      share,
      canShare: () => true,
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadFile('logbook.csv', 'date,name\n', 'text/csv')

    expect(click).not.toHaveBeenCalled()
  })
})
