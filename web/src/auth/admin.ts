// Admin detection for the few debug surfaces only the owner should see (today: the
// BLE lab card in Settings). The signal is a Supabase custom claim: `app_metadata.role`
// on the signed-in user. `app_metadata` can only be written server-side (dashboard, SQL,
// service role) and rides along in the access token, so a user cannot grant it to
// themselves from the client. `user_metadata` is user-writable and is deliberately
// ignored. Granting the claim is documented in docs/social-accounts-login-SETUP.md.

/** The slice of a supabase-js `User` this check needs; loose so tests can pass literals. */
export interface AdminCandidate {
  app_metadata?: unknown
}

export function isAdminUser(user: AdminCandidate | null | undefined): boolean {
  const meta = user?.app_metadata
  if (typeof meta !== 'object' || meta === null) return false
  return (meta as Record<string, unknown>).role === 'admin'
}
