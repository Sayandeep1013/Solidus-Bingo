/**
 * src/context/AuthContext.tsx
 *
 * Auth_Context — React Context that owns the full authentication lifecycle:
 *   - Session restoration on app start (with 5s timeout)
 *   - onAuthStateChange listener for token refresh / sign-out events
 *   - Profile loading after session established
 *   - Sign-in / sign-out delegation to src/lib/auth.ts
 *   - Username update via Supabase Edge Function (profile-service)
 *
 * From bingo-authentication spec:
 *   - Req 5: restore session on launch, 5s timeout → LoginScreen
 *   - Req 8: returning users skip LoginScreen entirely
 *   - Req 12: distinct error codes for each failure mode
 *   - Req 13: username update goes through profile-service Edge Function
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import * as SplashScreen from 'expo-splash-screen'
import { supabase } from '../lib/supabaseClient'
import { invokeEdgeFunction } from '../lib/invokeEdgeFunction'
import { signInWithGoogle, signOut as authSignOut } from '../lib/auth'
import type {
  AuthContextValue,
  AuthErrorCode,
  Profile,
  UsernameErrorCode,
} from '../types/auth'

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

/** 5-second timeout for the initial session restoration check (spec req 5.9) */
const SESSION_RESTORE_TIMEOUT_MS = 5_000

/** Max retries for profile load after OAuth (spec req 12.6) */
const PROFILE_LOAD_MAX_RETRIES = 3

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<AuthErrorCode | null>(null)

  const userId = session?.user?.id ?? null

  /**
   * Bug #4 fix: ref that holds the fallback timer started by signIn().
   * onAuthStateChange clears it when SIGNED_IN fires so it doesn't leak.
   */
  const signInFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Profile loader ──────────────────────────────────────────────────────────

  const loadProfile = useCallback(
    async (uid: string, retries = 0): Promise<void> => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .single()

        if (error) throw error
        setProfile(data as Profile)
        setAuthError(null)
      } catch (err: unknown) {
        // Bug #2 fix: PGRST116 = "no rows found" — normal for new users whose
        // DB trigger hasn't fired yet. Treat as "needs profile setup", not an error.
        const code = (err as { code?: string } | null)?.code
        if (code === 'PGRST116') {
          setProfile(null)
          setAuthError(null)
          return
        }

        if (retries < PROFILE_LOAD_MAX_RETRIES) {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = 500 * Math.pow(2, retries)
          await new Promise((r) => setTimeout(r, delay))
          return loadProfile(uid, retries + 1)
        }
        console.error('[AuthContext] profile load failed after retries:', err)
        setAuthError('PROFILE_LOAD_FAILED')
      }
    },
    []
  )

  // ── Session restoration on app start ───────────────────────────────────────

  // Bug #3 fix: replace the old getSession() + separate onAuthStateChange with
  // a single onAuthStateChange handler that covers INITIAL_SESSION.
  // This eliminates the race where both paths called loadProfile concurrently
  // and each called setIsLoading(false) independently.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED'
        ) {
          // Bug #4 fix: SIGNED_IN fired — cancel the signIn() fallback timer.
          if (signInFallbackRef.current !== null) {
            clearTimeout(signInFallbackRef.current)
            signInFallbackRef.current = null
          }

          if (newSession?.user?.id) {
            setSession(newSession)
            // Bug #5 fix (root cause of the "stuck on loader" report): this
            // callback runs INSIDE GoTrueClient's internal auth lock (it's
            // invoked from _notifyAllSubscribers while setSession()/the
            // initial session recovery still holds the lock). Any other
            // supabase.* call — including loadProfile()'s `.from('profiles')`
            // query — needs that same lock to attach the auth header, so
            // calling it directly here deadlocks forever: the query never
            // even reaches the network (confirmed via Supabase API logs
            // showing zero /rest/v1/profiles or /functions/v1/* requests
            // across multiple full login attempts). Deferring with
            // setTimeout(..., 0) runs it after this callback returns and the
            // lock is released. See supabase/supabase-js#1000.
            setTimeout(() => {
              loadProfile(newSession.user.id).finally(() => {
                setIsLoading(false)
                SplashScreen.hideAsync().catch(() => {})
              })
            }, 0)
          } else {
            setIsLoading(false)
            SplashScreen.hideAsync().catch(() => {})
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null)
          setProfile(null)
          setAuthError(null)
          setIsLoading(false)
          SplashScreen.hideAsync().catch(() => {})
        }
      }
    )

    // 5s fallback — if INITIAL_SESSION never fires (e.g. SecureStore slow or
    // cold start with no stored session), unblock the UI (spec req 5.9).
    const timeoutId = setTimeout(() => {
      setIsLoading(false)
      SplashScreen.hideAsync().catch(() => {})
    }, SESSION_RESTORE_TIMEOUT_MS)

    return () => {
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [loadProfile])

  // ── Sign in ────────────────────────────────────────────────────────────────

  const signIn = useCallback(async () => {
    setIsLoading(true)
    setAuthError(null)

    // Bug #4 fix: if onAuthStateChange(SIGNED_IN) never fires after a successful
    // OAuth exchange, the UI would be stuck loading forever. This 10s fallback
    // unblocks it. The ref is cleared in onAuthStateChange when SIGNED_IN fires.
    if (signInFallbackRef.current !== null) {
      clearTimeout(signInFallbackRef.current)
    }
    signInFallbackRef.current = setTimeout(() => {
      signInFallbackRef.current = null
      setIsLoading(false)
    }, 10_000)

    try {
      const result = await signInWithGoogle()
      if (result === 'cancelled') {
        clearTimeout(signInFallbackRef.current!)
        signInFallbackRef.current = null
        setAuthError('GOOGLE_AUTH_CANCELLED')
        setIsLoading(false)
      }
      // On 'success': onAuthStateChange(SIGNED_IN) will fire and call
      // setIsLoading(false) + clear the fallback timer above.
    } catch (err) {
      if (signInFallbackRef.current !== null) {
        clearTimeout(signInFallbackRef.current)
        signInFallbackRef.current = null
      }
      console.error('[AuthContext] sign-in error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('network') || msg.includes('fetch')) {
        setAuthError('NETWORK_ERROR')
      } else {
        setAuthError('GOOGLE_AUTH_FAILED')
      }
      setIsLoading(false)
    }
  }, [])

  // ── Sign out ───────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    setIsLoading(true)
    try {
      await authSignOut()
      // onAuthStateChange fires SIGNED_OUT and clears session/profile
    } catch (err) {
      console.error('[AuthContext] sign-out error:', err)
      setAuthError('SIGN_OUT_FAILED')
      // Spec req 9.5: always clear local state even if server call fails
      setSession(null)
      setProfile(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Profile update (username) ──────────────────────────────────────────────

  /**
   * Sends a username update request to the profile-service Edge Function.
   * Returns null on success or a UsernameErrorCode on validation failure.
   *
   * Validation order (spec req 7.4):
   *   1. CHARACTER validity → USERNAME_INVALID_CHARS
   *   2. LENGTH check       → USERNAME_TOO_SHORT / USERNAME_TOO_LONG
   *   3. UNIQUENESS check   → USERNAME_TAKEN
   */
  const updateProfile = useCallback(
    async (username: string): Promise<UsernameErrorCode | null> => {
      if (!userId) return null

      try {
        const { error } = await invokeEdgeFunction('profile-service', {
          body: { action: 'update_username', username },
        })

        if (error) {
          // Bug fix: supabase-js's functions.invoke() always returns
          // `data: null` on any non-2xx response (see FunctionsClient.invoke —
          // it throws FunctionsHttpError before parsing the body), so reading
          // the error code off `data?.code` can never work. The raw Response
          // is preserved on `error.context` with its body unread — read it
          // from there instead.
          if (error.name === 'FunctionsHttpError' && 'context' in error) {
            const body = await (error.context as Response).json().catch(() => null)
            const code = body?.error?.code as UsernameErrorCode | undefined
            if (
              code === 'USERNAME_INVALID_CHARS' ||
              code === 'USERNAME_TOO_SHORT' ||
              code === 'USERNAME_TOO_LONG' ||
              code === 'USERNAME_TAKEN'
            ) {
              return code
            }
          }
          throw error
        }

        // Refresh profile in context so username shows everywhere
        await loadProfile(userId)
        return null
      } catch (err) {
        console.error('[AuthContext] updateProfile error:', err)
        throw err
      }
    },
    [userId, loadProfile]
  )

  // ── Context value ──────────────────────────────────────────────────────────

  const value: AuthContextValue = {
    session,
    userId,
    profile,
    isLoading,
    authError,
    signIn,
    signOut,
    updateProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/** Use within any screen wrapped by AuthProvider */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
