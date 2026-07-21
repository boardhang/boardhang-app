import { supabase } from '../supabase/client'

/** The signed-in user's id, or null when signed out / unconfigured. Shared by the social
 *  stores so the same "who am I" lookup isn't copy-pasted per store. */
export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}
