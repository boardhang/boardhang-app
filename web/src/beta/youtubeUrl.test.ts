import { describe, expect, it } from 'vitest'
import { extractYouTubeId } from './youtubeUrl'

const ID = 'dQw4w9WgXcQ' // a real-shaped 11-char id

describe('extractYouTubeId', () => {
  it('extracts from every recognized URL shape', () => {
    expect(extractYouTubeId(`https://youtu.be/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://youtube.com/shorts/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID)
  })

  it('ignores extra query params and fragments', () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=30s&list=PLxyz`)).toBe(ID)
    expect(extractYouTubeId(`https://youtu.be/${ID}?t=42`)).toBe(ID)
    expect(extractYouTubeId(`https://youtu.be/${ID}#t=1m`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${ID}/`)).toBe(ID) // trailing slash
  })

  it('accepts a scheme-less URL', () => {
    expect(extractYouTubeId(`youtu.be/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`www.youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('rejects a bare id / 11-char word (must be a real YouTube link)', () => {
    expect(extractYouTubeId(ID)).toBeNull() // a raw id is not a link
    expect(extractYouTubeId('screenshots')).toBeNull() // 11-char word that matches the id charset
    expect(extractYouTubeId('Hello_World')).toBeNull()
  })

  it('trims whitespace around a URL', () => {
    expect(extractYouTubeId(`  https://youtu.be/${ID}\n`)).toBe(ID)
  })

  it('returns null for non-YouTube hosts', () => {
    expect(extractYouTubeId(`https://vimeo.com/${ID}`)).toBeNull()
    expect(extractYouTubeId('https://www.instagram.com/reel/abcdefghijk/')).toBeNull()
    expect(extractYouTubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull()
  })

  it('returns null for malformed / missing ids', () => {
    expect(extractYouTubeId('')).toBeNull()
    expect(extractYouTubeId('   ')).toBeNull()
    expect(extractYouTubeId('not a url at all')).toBeNull()
    expect(extractYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull() // too short
    expect(extractYouTubeId('https://youtu.be/toolongtoolongtoolong')).toBeNull() // too long
    expect(extractYouTubeId('https://www.youtube.com/watch')).toBeNull() // no v param
    expect(extractYouTubeId('https://www.youtube.com/feed/subscriptions')).toBeNull()
  })
})
