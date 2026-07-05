import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from '../supabase/client'
import { normalizeHandle } from './handle'
import { profileFromRow, type AuthStatus, type Profile, type ProfileRow } from './types'

interface AuthContextValue {
  status: AuthStatus
  profile: Profile | null
  /** True during initial session restore, so the UI never flashes "Sign in". */
  isRestoring: boolean
  /** Whether Supabase credentials are present; false disables every sign-in surface. */
  isConfigured: boolean
  sendEmailCode: (email: string) => Promise<void>
  verifyEmailCode: (email: string, code: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  isHandleAvailable: (handle: string) => Promise<boolean>
  saveProfile: (handle: string, displayName: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const NOT_CONFIGURED_MESSAGE =
  "Sign-in isn't set up in this build — see docs/social-accounts-login-SETUP.md."

/**
 * App-wide authentication + profile hub. Purely additive: the board/BLE app stays
 * fully usable signed-out. When Supabase is unconfigured the provider stays inert
 * (`signedOut`, `isConfigured === false`) and every method rejects rather than throwing
 * a bare reference error. Mirrors iOS `AuthManager`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('signedOut')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isRestoring, setIsRestoring] = useState(isConfigured)

  // Latest profile, read inside async resolves to implement iOS's "keep a known
  // profile on a transient load error" semantics without stale closures.
  const profileRef = useRef<Profile | null>(null)
  profileRef.current = profile

  const applyProfile = useCallback((next: Profile | null) => {
    profileRef.current = next
    setProfile(next)
  }, [])

  /**
   * Loads the current user's profile row and moves the status machine accordingly.
   * Distinguishes "row genuinely absent" (→ signedInNoProfile) from "request failed":
   * on failure we keep a known profile rather than re-showing setup to an established
   * user over a network blip, only defaulting to the no-profile gate if we never had
   * one this session.
   */
  const refreshProfile = useCallback(async () => {
    if (!supabase) return
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user.id
    if (!userId) {
      applyProfile(null)
      setStatus('signedOut')
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .limit(1)
    if (error) {
      // Request failed: keep whatever we already knew; only gate to no-profile if we
      // never resolved a profile this session.
      if (profileRef.current === null) setStatus('signedInNoProfile')
      return
    }
    const row = (data as ProfileRow[])[0]
    if (row) {
      applyProfile(profileFromRow(row))
      setStatus('signedInWithProfile')
    } else {
      applyProfile(null)
      setStatus('signedInNoProfile')
    }
  }, [applyProfile])

  useEffect(() => {
    if (!supabase) {
      setIsRestoring(false)
      return
    }
    // `onAuthStateChange` fires `INITIAL_SESSION` once on subscribe with the restored
    // (or absent) session — that doubles as launch-time restore, so no separate
    // bootstrap call is needed. The callback stays synchronous and defers the profile
    // fetch to a later tick: calling other Supabase methods inside the callback can
    // deadlock the client (documented supabase-js caveat).
    const resolveSession = async (session: Session | null) => {
      if (!session) {
        applyProfile(null)
        setStatus('signedOut')
        setIsRestoring(false)
        return
      }
      // Clear `isRestoring` only AFTER status resolves, so the header never shows
      // "Sign in" during the profile round-trip.
      await refreshProfile()
      setIsRestoring(false)
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolveSession(session)
    })

    return () => subscription.subscription.unsubscribe()
  }, [applyProfile, refreshProfile])

  const requireClient = useCallback(() => {
    if (!supabase) throw new Error(NOT_CONFIGURED_MESSAGE)
    return supabase
  }, [])

  const sendEmailCode = useCallback(
    async (email: string) => {
      const client = requireClient()
      const { error } = await client.auth.signInWithOtp({ email: email.trim() })
      if (error) throw error
    },
    [requireClient],
  )

  const verifyEmailCode = useCallback(
    async (email: string, code: string) => {
      const client = requireClient()
      const { error } = await client.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (error) throw error
    },
    [requireClient],
  )

  const signInWithGoogle = useCallback(async () => {
    const client = requireClient()
    // supabase-js navigates the browser to Google, then auto-completes the session on
    // return (detectSessionInUrl). `redirectTo` must be allow-listed in Supabase.
    // Kept dormant for now — no UI surfaces it until the web origin is allow-listed.
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) throw error
  }, [requireClient])

  const signOut = useCallback(async () => {
    const client = requireClient()
    const { error } = await client.auth.signOut()
    if (error) throw error
  }, [requireClient])

  const deleteAccount = useCallback(async () => {
    const client = requireClient()
    // `delete_user` is a SECURITY DEFINER RPC that deletes the calling auth user and
    // cascades to the profiles row. Then clear the local session.
    const { error } = await client.rpc('delete_user')
    if (error) throw error
    await client.auth.signOut()
  }, [requireClient])

  const isHandleAvailable = useCallback(
    async (handle: string) => {
      const client = requireClient()
      const normalized = normalizeHandle(handle)
      const { count, error } = await client
        .from('profiles')
        .select('id', { head: true, count: 'exact' })
        .eq('handle', normalized)
      if (error) throw error
      return (count ?? 0) === 0
    },
    [requireClient],
  )

  const saveProfile = useCallback(
    async (handle: string, displayName: string) => {
      const client = requireClient()
      const { data: sessionData } = await client.auth.getSession()
      const userId = sessionData.session?.user.id
      if (!userId) throw new Error('You need to be signed in to do that.')
      // The ONLY place a profiles row is created — client-side, after a valid handle.
      const { error } = await client.from('profiles').upsert({
        id: userId,
        handle: normalizeHandle(handle),
        display_name: displayName.trim(),
      })
      if (error) throw error
      await refreshProfile()
    },
    [requireClient, refreshProfile],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      profile,
      isRestoring,
      isConfigured,
      sendEmailCode,
      verifyEmailCode,
      signInWithGoogle,
      signOut,
      deleteAccount,
      isHandleAvailable,
      saveProfile,
    }),
    [
      status,
      profile,
      isRestoring,
      sendEmailCode,
      verifyEmailCode,
      signInWithGoogle,
      signOut,
      deleteAccount,
      isHandleAvailable,
      saveProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
