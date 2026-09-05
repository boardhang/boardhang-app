// The link-preview crawlers that get per-problem Open Graph tags. The pattern string
// is what web/vercel.json's `has` header condition carries (a parity test keeps the
// two identical), so it is written for Vercel's ANCHORED matcher — leading and
// trailing `.*` — and uses no inline flags (`(?i)` is undocumented there). Tokens have
// fixed casing in the wild.
//
// Admission rule: a token goes in only if no in-app browser sends it. A human whose
// agent matched would get the meta document instead of the app, and its one link
// points back at the same URL, so they would loop. FBAN/FBAV (Facebook app),
// Instagram, LinkedInApp and the Telegram/WhatsApp WebViews are therefore NOT here.
//
// Sources: iMessage sends "facebookexternalhit/1.1 Facebot Twitterbot/1.0" from the
// sender's device; Signal sends literally "WhatsApp/2"; the rest are the documented
// or observed agents of WhatsApp, Telegram, Discord, Slack, LinkedIn, X, Bluesky,
// Mastodon, Teams/Skype, Google Messages and Google Chat.

export const PREVIEW_CRAWLER_TOKENS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'WhatsApp/',
  'TelegramBot',
  'Discordbot',
  'Slackbot-LinkExpanding',
  'LinkedInBot',
  'Bluesky Cardyb',
  'Mastodon/',
  'SkypeUriPreview',
  'GoogleMessages',
  'Google-PageRenderer',
] as const

/** The `has[].value` regex for vercel.json — anchored by Vercel, hence the `.*` ends. */
export const PREVIEW_CRAWLER_PATTERN = `.*(${PREVIEW_CRAWLER_TOKENS.join('|')}).*`

const matcher = new RegExp(`^${PREVIEW_CRAWLER_PATTERN}$`)

/** True when a user agent would be routed to the preview functions by the rewrite. */
export function isPreviewCrawler(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && userAgent.length > 0 && matcher.test(userAgent)
}
