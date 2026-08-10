/**
 * Edge Function: profile-service
 *
 * Handles username validation and profile updates.
 * Runs with the Supabase Service Role — can write to public.profiles.
 *
 * Actions:
 *   update_username — validate + persist a new username for the caller
 *
 * Validation order (bingo-authentication spec §Req 7.4):
 *   1. CHARACTER validity → USERNAME_INVALID_CHARS
 *   2. LENGTH check       → USERNAME_TOO_SHORT / USERNAME_TOO_LONG
 *   3. UNIQUENESS check   → USERNAME_TAKEN (case-insensitive)
 *
 * Called by the client with the user's JWT — auth.uid() identifies the user.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

const USERNAME_CHARS_RE = /^[A-Za-z0-9_-]+$/
const USERNAME_MIN = 1
const USERNAME_MAX = 30

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  try {
    // ── Parse request body ───────────────────────────────────────────────────
    let body: { action?: unknown; username?: unknown }
    try {
      body = await req.json()
    } catch {
      return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
    }
    const { action, username } = body

    if (action !== 'update_username') {
      return err('INVALID_INPUT', `Unknown action: ${action}`, 400)
    }

    if (typeof username !== 'string') {
      return err('INVALID_INPUT', 'username must be a string', 400)
    }

    const trimmed = username.trim()

    // ── Validate: character set (checked first per spec) ────────────────────
    if (!USERNAME_CHARS_RE.test(trimmed)) {
      return err('USERNAME_INVALID_CHARS', 'Invalid characters in username', 422)
    }

    // ── Validate: length ─────────────────────────────────────────────────────
    if (trimmed.length < USERNAME_MIN) {
      return err('USERNAME_TOO_SHORT', 'Username is too short', 422)
    }

    if (trimmed.length > USERNAME_MAX) {
      return err('USERNAME_TOO_LONG', 'Username is too long', 422)
    }

    // ── Service-role Supabase instance (bypasses RLS for the uniqueness check
    //    and the UPDATE) ───────────────────────────────────────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Validate: uniqueness (case-insensitive) ──────────────────────────────
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('username', trimmed)
      .neq('id', userId)  // exclude the caller's own current row
      .maybeSingle()

    if (lookupError) {
      console.error('[profile-service] uniqueness check failed:', lookupError)
      return err('INTERNAL_ERROR', 'Database error', 500)
    }

    if (existing) {
      return err('USERNAME_TAKEN', 'Username is already taken', 422)
    }

    // ── Persist the update ───────────────────────────────────────────────────
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ username: trimmed })
      .eq('id', userId)

    if (updateError) {
      // Handle unique constraint violation (race condition)
      if (updateError.code === '23505') {
        return err('USERNAME_TAKEN', 'Username is already taken', 422)
      }
      console.error('[profile-service] update failed:', updateError)
      return err('INTERNAL_ERROR', 'Failed to update username', 500)
    }

    // ── Success ──────────────────────────────────────────────────────────────
    return ok({ success: true })

  } catch (err_) {
    console.error('[profile-service] unhandled error:', err_)
    return err('INTERNAL_ERROR', 'Unexpected error', 500)
  }
})
