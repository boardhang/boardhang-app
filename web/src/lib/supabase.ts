// Minimal Supabase REST access for the PWA.
//
// The problem catalog is public (migration 0003 grants anon SELECT on catalog_problems),
// so we read it straight from PostgREST with the anon key — no @supabase/supabase-js
// dependency needed for this read-only, unauthenticated path. Credentials come from the
// same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env the rest of the app uses; when
// they're absent the helpers degrade to "no data" so the app still runs.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when both Supabase credentials are present. */
export const supabaseConfigured = Boolean(url && anonKey)

/**
 * GET rows from a PostgREST table with the anon key. `query` is a raw PostgREST
 * querystring, e.g. `layout_id=eq.7&angle=eq.40&order=updated_at.asc`. Returns `[]`
 * when unconfigured so callers degrade gracefully before setup; throws on a network /
 * HTTP error so callers can leave their cursor unchanged and retry later.
 */
export async function restGet<T>(table: string, query: string): Promise<T[]> {
  if (!url || !anonKey) return []
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
  if (!res.ok) throw new Error(`Supabase ${table} request failed: ${res.status}`)
  return (await res.json()) as T[]
}
