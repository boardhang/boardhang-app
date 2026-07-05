import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase is optional: the board/BLE app is fully usable signed-out. When the env
// vars are absent (e.g. a build without credentials) we export a null client and
// `isConfigured === false`, and every auth surface disables itself rather than
// throwing. Mirrors the iOS SupabaseClientProvider's graceful-unconfigured behavior.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

// `detectSessionInUrl` (default true) auto-completes an OAuth redirect when the browser
// returns to the app; `persistSession` + `autoRefreshToken` (defaults) keep the session
// alive across reloads. We keep the defaults explicit for clarity.
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
