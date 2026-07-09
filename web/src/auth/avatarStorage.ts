// Avatar storage helpers (U3). Wraps the `avatars` bucket (public; bucket + owner-scoped
// RLS in supabase/migrations/0009_avatars.sql). The app stores only the OBJECT PATH
// (`{userId}/{uuid}.webp`) in `profiles.avatar_url` — never a full URL — so the DB CHECK
// can guarantee the value points inside our bucket (an external value would be a
// tracking-pixel / IP-leak, since avatar_url renders in other members' browsers). The
// public URL is derived at read time via {@link avatarPublicUrl}.

import { supabase } from '../supabase/client'

export const AVATARS_BUCKET = 'avatars'

/** An in-bucket object path: `{uuid}/{uuid}.webp` (two UUID-shaped segments). Mirrors the
 *  `avatar_url_is_bucket_path` CHECK in 0009 — used client-side as defense in depth. */
export const AVATAR_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i

/** True when `value` is null (no avatar) or a valid in-bucket object path. */
export function isAvatarPath(value: string | null): boolean {
  return value === null || AVATAR_PATH_RE.test(value)
}

function requireClient() {
  if (!supabase) throw new Error('Avatars aren’t available right now — sign-in is unconfigured.')
  return supabase
}

/** Derive the public URL for a stored avatar path (pure string build via the SDK; no
 *  network). Returns null for a null path or an unconfigured client, so render sites fall
 *  back to initials. */
export function avatarPublicUrl(path: string | null): string | null {
  if (!path || !supabase) return null
  return supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Upload a processed WebP blob to `{userId}/{uuid}.webp` and return the stored path.
 *  A fresh UUID per upload means the URL always changes, sidestepping CDN cache staleness;
 *  the caller deletes the previous object after the new path is persisted (see AccountMenu).
 *  `contentType` is taken from the blob (U2 guarantees WebP), not hardcoded. */
export async function uploadAvatar(userId: string, blob: Blob): Promise<{ path: string }> {
  const client = requireClient()
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await client.storage.from(AVATARS_BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  })
  if (error) throw error
  return { path }
}

/** Best-effort delete of a stored avatar object. Swallows errors (a stray orphan is public
 *  and tiny, and account deletion sweeps the folder anyway — see 0009 delete_user()). */
export async function deleteAvatarObject(path: string): Promise<void> {
  if (!supabase) return
  await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([path])
    .then(
      () => {},
      () => {},
    )
}
