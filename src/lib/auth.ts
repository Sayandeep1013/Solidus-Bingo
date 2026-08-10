/**
 * src/lib/auth.ts
 *
 * Auth_Manager — handles Google OAuth sign-in, deep link token exchange,
 * and sign-out. This module owns the browser interaction layer only.
 * Session state is managed by AuthContext.
 *
 * Rules (from bingo-authentication spec):
 * - Use WebBrowser.openAuthSessionAsync — NOT an in-app WebView
 * - Use skipBrowserRedirect: true — we open the browser ourselves
 * - Use supabase.auth.setSession() to exchange tokens — NOT auto-redirect
 * - detectSessionInUrl: false is already set on the Supabase client
 * - Never expose Google Client Secret or Service Role Key here
 */
import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabaseClient'

// Required for Expo web support — no-op on native
WebBrowser.maybeCompleteAuthSession()

/**
 * Hardcoded redirect URI — avoids makeRedirectUri() generating bingo:///auth/callback
 * (triple slash) on standalone APKs, which expo-router can't match as a route.
 * Must match exactly what's registered in Supabase Auth → Redirect URLs.
 */
const REDIRECT_URI = 'bingo://auth/callback'

/**
 * Bug #1 fix: guard against double createSessionFromUrl calls.
 *
 * signInWithGoogle() calls createSessionFromUrl(result.url) after
 * openAuthSessionAsync returns. The root _layout.tsx Linking listener fires
 * for the same URL concurrently and would call handleDeepLink →
 * createSessionFromUrl a second time, double-consuming the PKCE token.
 *
 * While this flag is true, handleDeepLink returns early.
 */
let handlingOAuth = false

// ─────────────────────────────────────────────────────────────────────────────
// Sign-in
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the system browser for Google OAuth and exchanges the resulting
 * tokens for a Supabase session.
 *
 * Returns:
 *   'success'   — session established
 *   'cancelled' — user closed the browser (no error shown to user per spec)
 *
 * Throws on OAuth errors from Google (caller must handle and show message).
 */
export async function signInWithGoogle(): Promise<'success' | 'cancelled'> {
  // 1. Get the Google sign-in URL from Supabase (skipBrowserRedirect = we open it)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: REDIRECT_URI,
      skipBrowserRedirect: true, // REQUIRED — we control the browser ourselves
    },
  })

  if (error) throw error
  if (!data.url) throw new Error('No OAuth URL returned from Supabase')

  // 2. Open the system browser (NOT an in-app WebView)
  // Set flag so handleDeepLink ignores the concurrent Linking event for this URL
  handlingOAuth = true
  let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>
  try {
    result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI)
  } finally {
    handlingOAuth = false
  }

  if (result.type === 'cancel') {
    // User dismissed the browser — not an error per spec requirement 4.4
    return 'cancelled'
  }

  if (result.type !== 'success') {
    throw new Error(`OAuth browser returned unexpected result: ${result.type}`)
  }

  // 3. Exchange the URL tokens for a Supabase session
  await createSessionFromUrl(result.url)
  return 'success'
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep link token exchange
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the access_token and refresh_token out of a bingo://auth/callback URL
 * and calls supabase.auth.setSession() to establish the session.
 *
 * Called from:
 *   - signInWithGoogle() (result.url from openAuthSessionAsync)
 *   - handleDeepLink() (cold-start or foreground URL event)
 */
export async function createSessionFromUrl(url: string): Promise<void> {
  // Extract the fragment part (#access_token=...&refresh_token=...&...)
  // Don't use new URL() — it may fail on custom schemes (bingo://) in some RN environments
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')

  let paramString = ''
  if (hashIndex !== -1) {
    // Tokens are in the fragment: bingo://auth/callback#access_token=...
    paramString = url.slice(hashIndex + 1)
  } else if (queryIndex !== -1) {
    // Tokens are in query params: bingo://auth/callback?access_token=...
    paramString = url.slice(queryIndex + 1)
  }

  if (!paramString) return

  // Parse manually — URLSearchParams works reliably in RN
  const params = new URLSearchParams(paramString)
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  const errorCode = params.get('error')

  if (errorCode) {
    throw new Error(`OAuth error: ${errorCode} — ${params.get('error_description') ?? ''}`)
  }

  if (!access_token) {
    // URL doesn't contain a token — may be a redirect without tokens, ignore
    return
  }

  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token: refresh_token ?? '',
  })

  if (error) throw error
}

/**
 * Handles a deep link URL arriving while the app is open (foreground) or on
 * cold start. Ignores URLs that aren't auth/callback.
 *
 * Registered in app/_layout.tsx before navigation renders (spec req 3.4).
 */
export async function handleDeepLink(url: string): Promise<void> {
  if (!url.includes('auth/callback')) return

  // Bug #1 fix: signInWithGoogle() is already handling this URL via
  // createSessionFromUrl(result.url). Skip to avoid double token exchange.
  if (handlingOAuth) {
    console.info('[handleDeepLink] skipped — signInWithGoogle is handling this URL')
    return
  }

  try {
    await createSessionFromUrl(url)
  } catch (err) {
    // Log but don't crash — deep link errors leave the user on Login (spec req 3.6)
    console.error('[handleDeepLink] token exchange failed:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-out
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signs the user out:
 *   1. Calls supabase.auth.signOut() to invalidate the server-side session.
 *   2. If the network call fails, local session is still cleared (spec req 9.5).
 *
 * AuthContext observes onAuthStateChange and clears in-memory state when the
 * SIGNED_OUT event fires, so no store clearing is needed here.
 */
export async function signOut(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) console.warn('[signOut] server sign-out failed:', error.message)
  } catch (err) {
    // Network error — spec requires we still clear local state
    console.warn('[signOut] network error during server sign-out:', err)
  }
  // The Supabase client clears SecureStore tokens automatically on sign-out,
  // and fires the SIGNED_OUT event which AuthContext listens to.
}
