/**
 * src/types/auth.ts
 *
 * Shared types for the authentication layer.
 */
import type { Session } from '@supabase/supabase-js'

// ─── Profile ────────────────────────────────────────────────────────────────

/** A row from public.profiles */
export interface Profile {
  id: string
  username: string | null   // NULL until Profile_Setup_Screen completes
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// ─── Auth error codes ────────────────────────────────────────────────────────

/** Distinct error conditions from bingo-authentication spec §Req 12 */
export type AuthErrorCode =
  | 'GOOGLE_AUTH_CANCELLED'
  | 'GOOGLE_AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'PROFILE_LOAD_FAILED'
  | 'SIGN_OUT_FAILED'

/** Username validation errors from bingo-authentication spec §Req 7 */
export type UsernameErrorCode =
  | 'USERNAME_INVALID_CHARS'
  | 'USERNAME_TOO_SHORT'
  | 'USERNAME_TOO_LONG'
  | 'USERNAME_TAKEN'

// ─── Context shape ───────────────────────────────────────────────────────────

export interface AuthContextValue {
  /** The current Supabase session (null = not logged in) */
  session: Session | null
  /** Convenience alias for session.user.id */
  userId: string | null
  /** The player's profile row (null = session exists but profile not yet loaded) */
  profile: Profile | null
  /** True while session restoration or sign-in/sign-out is in progress */
  isLoading: boolean
  /** The most recent auth error (null = no error) */
  authError: AuthErrorCode | null

  /** Trigger Google OAuth sign-in flow */
  signIn: () => Promise<void>
  /** Sign out and clear all state */
  signOut: () => Promise<void>
  /**
   * Update the username on the profile.
   * Returns null on success, or a UsernameErrorCode on validation failure.
   */
  updateProfile: (username: string) => Promise<UsernameErrorCode | null>
}
