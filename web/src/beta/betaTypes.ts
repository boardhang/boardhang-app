// A beta clip attached to a catalog problem — the approved-readable columns of
// public.problem_beta_videos (0010). The client only ever reads approved rows (RLS gates
// pending/rejected), so this mirrors the SELECT column list in betaStore.
export interface BetaVideo {
  id: string
  source_catalog_id: string
  provider: 'youtube' | 'instagram'
  video_id: string
  title: string
  channel: string
  duration_s: number | null
  is_short: boolean
  views: number
  /**
   * Per-viewer derived flag — NOT a problem_beta_videos column. Set at fetch time from the
   * signed-in identity (via an owner-scoped lookup in betaStore); true when the current user
   * submitted this clip. Defaults false for anon viewers, other users, and lookup failures.
   */
  isMine: boolean
}
