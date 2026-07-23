import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadFile } from './downloadFile'

describe('downloadFile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an object URL from a typed Blob and triggers an anchor download', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadFile('logbook.csv', 'date,name\n', 'text/csv')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/csv')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('revokes the object URL after triggering the download (no leak)', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadFile('logbook.json', '{}', 'application/json')

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
