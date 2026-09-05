import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProblem } from './catalogSync'
import { problemShareText, problemShareUrl, shareProblem } from './problemShareUrl'

const row: CatalogProblem = {
  source_catalog_id: 'abc',
  layout_id: 2,
  angle: 25,
  name: 'Chunky Monkey',
  grade: '7A',
  user_grade: null,
  setter: 'Alice',
  stars: 3,
  repeats: 12,
  is_benchmark: false,
  method: null,
  holds: [{ c: 0, r: 1, t: 'start' }],
}

function setNavigator(overrides: { share?: unknown; clipboard?: unknown }) {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(navigator, key, { value, configurable: true })
  }
}

function abortError(): Error {
  const e = new Error('cancelled')
  e.name = 'AbortError'
  return e
}

beforeEach(() => {
  setNavigator({ share: undefined, clipboard: undefined })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('problemShareUrl', () => {
  it('builds the canonical link from the row: layout, angle and id, nothing else (AE1)', () => {
    const url = new URL(problemShareUrl(row))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe('/board/2/catalog')
    expect(url.searchParams.get('angle')).toBe('25')
    expect(url.searchParams.get('problem')).toBe('abc')
    expect([...url.searchParams.keys()].sort()).toEqual(['angle', 'problem'])
  })

  it('URL-encodes an id that needs it', () => {
    const url = problemShareUrl({ ...row, source_catalog_id: 'a b&c' })
    expect(url).toContain('problem=a+b%26c')
    expect(new URL(url).searchParams.get('problem')).toBe('a b&c')
  })
})

describe('problemShareText', () => {
  it('is "Name Grade" and does not contain the URL', () => {
    const text = problemShareText(row)
    expect(text).toBe('Chunky Monkey 7A')
    expect(text).not.toContain('http')
  })
})

describe('shareProblem', () => {
  it('calls navigator.share synchronously with title, text and url, no clipboard (AE2)', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share, clipboard: { writeText } })

    const outcome = shareProblem(row)
    // Synchronous: called before the promise is awaited (Safari transient activation).
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({
      title: 'Chunky Monkey 7A',
      text: 'Chunky Monkey 7A',
      url: problemShareUrl(row),
    })
    expect(await outcome).toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a cancelled sheet as a silent no-op (AE3)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share: vi.fn().mockRejectedValue(abortError()), clipboard: { writeText } })
    expect(await shareProblem(row)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard once when share rejects for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const err = new Error('nope')
    err.name = 'NotAllowedError'
    setNavigator({ share: vi.fn().mockRejectedValue(err), clipboard: { writeText } })
    expect(await shareProblem(row)).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(problemShareUrl(row))
  })

  it('falls back to the clipboard when navigator.share throws synchronously', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const share = vi.fn(() => {
      throw new TypeError('Illegal invocation')
    })
    setNavigator({ share, clipboard: { writeText } })
    expect(await shareProblem(row)).toBe('copied')
    expect(share).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(problemShareUrl(row))
  })

  it('copies the link when there is no share API (AE4)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ clipboard: { writeText } })
    expect(await shareProblem(row)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(problemShareUrl(row))
  })

  it('reports failure when neither share nor clipboard exists (AE5)', async () => {
    expect(await shareProblem(row)).toBe('failed')
  })

  it('reports failure when the clipboard write rejects', async () => {
    setNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    expect(await shareProblem(row)).toBe('failed')
  })
})
