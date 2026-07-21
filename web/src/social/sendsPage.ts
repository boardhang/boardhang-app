// Keyset pagination for the sends projection — a user's profile sends (get_user_sends), the
// single-actor wrapper over the revoked _sends_for_actors core. Pages on (first_sent_at, id).
// Kept as a small module (rather than inlined into ProfileSends) so the RPC name + params stay
// in one place and the fetch/map is unit-testable in isolation.

import { supabase } from '../supabase/client'
import { sendFromRow, type SendItem, type SendRow } from './socialTypes'

/** Page size for the profile-sends keyset pagination. */
export const SENDS_PAGE = 30

/**
 * Fetch one keyset page from a sends-projection RPC. `cursor` is the previous page's last row
 * (null for the first page); `extra` carries RPC-specific params (e.g. `{ p_target }`). Returns
 * mapped SendItems, or null on a fetch error (callers distinguish that from an empty page).
 */
export async function fetchSendsPage(
  rpc: string,
  cursor: SendItem | null,
  extra: Record<string, unknown> = {},
): Promise<SendItem[] | null> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc(rpc, {
    ...extra,
    p_limit: SENDS_PAGE,
    p_before_first_sent: cursor?.firstSentAt ?? null,
    p_before_id: cursor?.ascentId ?? null,
  })
  if (error) return null
  return ((data ?? []) as SendRow[]).map(sendFromRow)
}
