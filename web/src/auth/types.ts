import { avatarPublicUrl } from './avatarStorage'

// A row of the `profiles` table — the app's user identity (see 0001_profiles.sql).
// Minimal by design: handle + displayName. `avatarPath` is the raw stored value — an
// in-bucket object path (`{uid}/{uuid}.webp`) or null (0009); `avatarUrl` is the derived
// public URL for rendering. `createdAt` is kept as a raw string so profile loading never
// fails on a timestamp mismatch. Mirrors iOS `Profile`.
export interface Profile {
  id: string
  handle: string
  displayName: string
  /** Raw stored object path (`{uid}/{uuid}.webp`) or null — needed to delete the old
   *  object on replace. Rendering uses {@link Profile.avatarUrl}. */
  avatarPath: string | null
  /** Public URL derived from {@link Profile.avatarPath}, or null — feeds `<AvatarImage>`. */
  avatarUrl: string | null
  createdAt: string | null
}

// The three-state machine the whole app keys off (mirrors iOS AuthManager.Status):
//   • signedOut            — no session; offer sign-in from the header.
//   • signedInNoProfile    — authenticated but no `profiles` row yet.
//   • signedInWithProfile  — full identity; `profile` is non-null.
export type AuthStatus = 'signedOut' | 'signedInNoProfile' | 'signedInWithProfile'

// The database row shape (snake_case) as returned by PostgREST.
export interface ProfileRow {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
  created_at: string | null
}

export function profileFromRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarPath: row.avatar_url,
    avatarUrl: avatarPublicUrl(row.avatar_url),
    createdAt: row.created_at,
  }
}
