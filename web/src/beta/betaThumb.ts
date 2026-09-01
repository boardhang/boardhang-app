import type { BetaVideo } from './betaTypes'

// hqdefault is a 480×360 LANDSCAPE frame (Shorts are pillarboxed) — object-cover crops it to
// the portrait card. There is no reliable static portrait thumbnail for a Short.
export function thumb(v: BetaVideo): string {
  return `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`
}
