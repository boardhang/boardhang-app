// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PREVIEW_CRAWLER_PATTERN, isPreviewCrawler } from './crawlers.js'

interface VercelRewrite {
  source: string
  destination: string
  has?: { type: string; key: string; value?: string }[]
}

const crawlers: Record<string, string> = {
  iMessage: 'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  Facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  WhatsApp: 'WhatsApp/2.23.20.0 A',
  Signal: 'WhatsApp/2',
  Telegram: 'TelegramBot (like TwitterBot)',
  Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  LinkedIn: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  X: 'Twitterbot/1.0',
  Bluesky: 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)',
  Mastodon: 'Mastodon/4.2.0 (http.rb/5.1.1; +https://mastodon.social/) Bot',
  Teams: 'SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com',
  GoogleMessages: 'Mozilla/5.0 (Linux; Android 10) GoogleMessages/1.0',
}

const humans: Record<string, string> = {
  Chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  FacebookApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.30.115;FBBV/533055786;FBDV/iPhone14,2]',
  Instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0',
  LinkedInApp:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36 LinkedInApp',
  TelegramAndroid:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  WhatsAppWebView:
    'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36',
}

describe('preview crawler pattern', () => {
  for (const [name, ua] of Object.entries(crawlers)) {
    it(`matches ${name}`, () => {
      expect(isPreviewCrawler(ua)).toBe(true)
    })
  }

  for (const [name, ua] of Object.entries(humans)) {
    it(`does not match ${name}`, () => {
      expect(isPreviewCrawler(ua)).toBe(false)
    })
  }

  it('does not match an empty or missing agent', () => {
    expect(isPreviewCrawler('')).toBe(false)
    expect(isPreviewCrawler(null)).toBe(false)
    expect(isPreviewCrawler(undefined)).toBe(false)
  })

  it('is written for an anchored matcher (leading and trailing .*)', () => {
    expect(PREVIEW_CRAWLER_PATTERN.startsWith('.*(')).toBe(true)
    expect(PREVIEW_CRAWLER_PATTERN.endsWith(').*')).toBe(true)
    expect(PREVIEW_CRAWLER_PATTERN).not.toContain('(?i)')
  })

  it('is byte-identical to the user-agent condition of the crawler rewrite in vercel.json, which precedes the catch-all', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8')) as {
      rewrites: VercelRewrite[]
    }
    const crawlerIndex = config.rewrites.findIndex((r) => r.source === '/board/:layoutId/catalog')
    const catchAllIndex = config.rewrites.findIndex((r) => r.source === '/(.*)')
    expect(crawlerIndex).toBeGreaterThanOrEqual(0)
    expect(crawlerIndex).toBeLessThan(catchAllIndex)
    const rule = config.rewrites[crawlerIndex]
    const ua = rule.has?.find((h) => h.type === 'header' && h.key === 'user-agent')
    expect(ua?.value).toBe(PREVIEW_CRAWLER_PATTERN)
    const query = rule.has?.find((h) => h.type === 'query' && h.key === 'problem')
    expect(query?.value).toBe('(?<problem>.+)')
    expect(rule.destination).toBe('/api/og-page?layoutId=:layoutId&problem=:problem')
  })
})
