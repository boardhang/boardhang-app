import { describe, expect, it } from 'vitest'
import { redactPath, redactUrl, routeTemplate } from './analytics'

describe('redactPath', () => {
  it('hides a session join token', () => {
    expect(redactPath('/session/join/abc123')).toBe('/session/join/[token]')
  })

  it('hides a list id', () => {
    expect(redactPath('/lists/9f0c1e2a-0000-4000-8000-000000000000')).toBe('/lists/[listId]')
  })

  it('leaves non-identifying paths alone', () => {
    expect(redactPath('/board/7/catalog')).toBe('/board/7/catalog')
    expect(redactPath('/lists')).toBe('/lists')
    expect(redactPath('/logbook/import')).toBe('/logbook/import')
  })
})

describe('redactUrl', () => {
  it('drops the query string and hash', () => {
    expect(redactUrl('https://www.boardhang.app/board/7/catalog?problem=42&grade=6C#access_token=secret')).toBe(
      'https://www.boardhang.app/board/7/catalog',
    )
  })

  it('redacts the path too', () => {
    expect(redactUrl('https://www.boardhang.app/session/join/abc123?x=1')).toBe(
      'https://www.boardhang.app/session/join/[token]',
    )
  })

  it('still strips query and hash from something that is not an absolute URL', () => {
    expect(redactUrl('/logbook?tab=sessions#top')).toBe('/logbook')
  })
})

describe('routeTemplate', () => {
  it('rewrites route params into bracket form', () => {
    expect(routeTemplate('/board/$layoutId/catalog')).toBe('/board/[layoutId]/catalog')
    expect(routeTemplate('/session/join/$token')).toBe('/session/join/[token]')
  })

  it('passes a static route through', () => {
    expect(routeTemplate('/settings')).toBe('/settings')
  })

  it('has no template when nothing but the root matched', () => {
    expect(routeTemplate('__root__')).toBeNull()
    expect(routeTemplate(undefined)).toBeNull()
  })
})
