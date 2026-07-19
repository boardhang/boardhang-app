import { describe, expect, it } from 'vitest'
import { buildJoinUrl, parseJoinUrl } from './joinUrl'

describe('parseJoinUrl', () => {
  it('extracts the token from a full production-style URL', () => {
    expect(parseJoinUrl('https://boardhang.app/session/join/abc123')).toBe('abc123')
  })

  it('ignores origin — localhost and preview URLs yield the same token', () => {
    expect(parseJoinUrl('http://localhost:5173/session/join/abc123')).toBe('abc123')
    expect(parseJoinUrl('https://dist-six-livid-1h9ns7kuqc.vercel.app/session/join/abc123')).toBe(
      'abc123',
    )
  })

  it('tolerates a trailing slash', () => {
    expect(parseJoinUrl('https://boardhang.app/session/join/abc123/')).toBe('abc123')
  })

  it('tolerates surrounding whitespace (pasted text)', () => {
    expect(parseJoinUrl('  https://boardhang.app/session/join/abc123  \n')).toBe('abc123')
  })

  it('tolerates a pasted link that lost its scheme', () => {
    expect(parseJoinUrl('boardhang.app/session/join/abc123')).toBe('abc123')
  })

  it('returns null for a bare token string (not a URL)', () => {
    expect(parseJoinUrl('abc123')).toBeNull()
  })

  it('returns null for an empty token', () => {
    expect(parseJoinUrl('https://boardhang.app/session/join/')).toBeNull()
    expect(parseJoinUrl('https://boardhang.app/session/join')).toBeNull()
  })

  it('returns null for a same-origin unrelated path', () => {
    expect(parseJoinUrl('https://boardhang.app/boards')).toBeNull()
  })

  it('returns null for an extra path segment after the token', () => {
    expect(parseJoinUrl('https://boardhang.app/session/join/abc123/extra')).toBeNull()
  })

  it('returns null for non-session QR payloads (Wi-Fi)', () => {
    expect(parseJoinUrl('WIFI:S:MyNetwork;T:WPA;P:secret;;')).toBeNull()
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(parseJoinUrl('')).toBeNull()
    expect(parseJoinUrl('   ')).toBeNull()
  })
})

describe('buildJoinUrl / parseJoinUrl round-trip', () => {
  it('parseJoinUrl recovers the token buildJoinUrl encoded', () => {
    const token = 'a1b2c3d4e5f6'
    expect(parseJoinUrl(buildJoinUrl(token))).toBe(token)
  })
})
