// Client-side YouTube URL → video_id extractor (U3). The client never calls the YouTube API
// (the key never ships); it only pulls the 11-char id out of a pasted link and stores that. The
// server-side enrich pass fills title/channel/views/duration later. Returns null for anything
// that isn't a recognizable YouTube video reference — the submit UI treats null as "not a valid
// YouTube link" and never inserts.

const ID_RE = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

function parseUrl(raw: string): URL | null {
  // Accept links pasted without a scheme (e.g. "youtu.be/…") by retrying with https://.
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      return new URL(candidate)
    } catch {
      // try the next form
    }
  }
  return null
}

/**
 * Extract an 11-char YouTube video id from a pasted URL. Handles youtu.be/<id>, watch?v=<id>,
 * /shorts/<id>, /embed/<id>, /live/<id>, tolerates extra query params and fragments, and returns
 * null for non-YouTube hosts or malformed ids. A bare id (no URL) is intentionally NOT accepted:
 * ordinary 11-char words match the id charset, so requiring a real YouTube link avoids stuck
 * pending rows from a fumbled paste — real users paste share links, not raw ids.
 */
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const url = parseUrl(trimmed)
  if (!url) return null

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  let candidate: string | null = null
  if (host === 'youtu.be') {
    candidate = segments[0] ?? null
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') {
      candidate = url.searchParams.get('v')
    } else if (
      segments[0] === 'shorts' ||
      segments[0] === 'embed' ||
      segments[0] === 'live'
    ) {
      candidate = segments[1] ?? null
    }
  } else {
    return null // non-YouTube host
  }

  return candidate && ID_RE.test(candidate) ? candidate : null
}
