/**
 * Edge Function: reclaim-seat
 *
 * Req 3.5.3: the moment a disconnected player reconnects, they immediately
 * regain control of their own seat — no re-vote, no waiting for their next
 * turn. Called by the player's own client as soon as it notices (via the
 * game_players Realtime subscription) that its own seat is bot_controlled.
 * If it's currently the bot's turn, this just clears the flag — the
 * player's board already reflects everything the bot called on their
 * behalf, and the existing turn/board rendering just works once
 * bot_controlled flips false (no special "hand off mid-turn" logic needed).
 *
 * Request body: { game_id }
 * Response: { reclaimed: boolean }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.5.3
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { game_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.game_id !== 'string') {
    return err('INVALID_INPUT', 'game_id is required', 400)
  }
  const gameId = body.game_id

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: gamePlayer, error: gpError } = await admin
    .from('game_players')
    .select('player_id, is_out, bot_controlled')
    .eq('game_id', gameId)
    .eq('player_id', userId)
    .maybeSingle()

  if (gpError || !gamePlayer) {
    return err('FORBIDDEN', 'You are not a player in this game', 403)
  }

  if (!gamePlayer.bot_controlled) {
    // Nothing to reclaim — already in full control (or was never handed off).
    return ok({ reclaimed: false })
  }

  await admin
    .from('game_players')
    .update({ bot_controlled: false })
    .eq('game_id', gameId)
    .eq('player_id', userId)

  return ok({ reclaimed: true })
})
