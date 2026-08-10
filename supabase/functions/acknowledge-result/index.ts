/**
 * Edge Function: acknowledge-result
 *
 * Marks a finished game's outcome as seen by the caller, so the "while you
 * were away" Home-screen notification only ever surfaces a given game's
 * result once — spec .kiro/specs/bingo-disconnect-recovery/requirements.md
 * §3.8.4. Called when the player views the Result screen (whether they were
 * live for the finish or are seeing it after reopening the app) or
 * dismisses the away-notification directly without opening the game.
 *
 * Request body: { room_id }
 * Response: { acknowledged: true }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { room_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.room_id !== 'string') {
    return err('INVALID_INPUT', 'room_id is required', 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await admin
    .from('room_players')
    .update({ result_seen_at: new Date().toISOString() })
    .eq('room_id', body.room_id)
    .eq('player_id', userId)

  if (error) {
    console.error('[acknowledge-result] update error:', error)
    return err('INTERNAL_ERROR', 'Failed to acknowledge result', 500)
  }

  return ok({ acknowledged: true })
})
