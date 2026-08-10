/**
 * Edge Function: forfeit-self
 *
 * Voluntary concede — "I'm in a game but don't feel like playing anymore."
 * Immediate, no grace period, no vote — you chose it yourself, so there's
 * no ambiguity to protect against the way there is for a disconnect.
 *
 * Request body: { game_id }
 * Response: { game_status, winner_id, next_active_player_id, updated_scores }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.7
 * - 2-player game → opponent wins outright
 * - 3-4 player game → dropped from rotation, everyone else keeps playing
 *   (resolvePlayerOut handles both paths identically to a timeout or a
 *   passed forfeit vote — same underlying mechanism, different trigger)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolvePlayerOut } from '../_shared/resolvePlayerOut.ts'

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

  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id, room_id, status')
    .eq('id', gameId)
    .single()

  if (gameError || !game) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  if (game.status !== 'ACTIVE') {
    return err('GAME_NOT_ACTIVE', `Game is not active (status: ${game.status})`, 409)
  }

  const { data: myRow } = await admin
    .from('game_players')
    .select('player_id, is_out')
    .eq('game_id', gameId)
    .eq('player_id', userId)
    .maybeSingle()

  if (!myRow) {
    return err('FORBIDDEN', 'You are not a player in this game', 403)
  }
  if (myRow.is_out) {
    return err('ALREADY_OUT', 'You have already left this game', 409)
  }

  const { data: room } = await admin
    .from('rooms')
    .select('capacity, is_ranked')
    .eq('id', game.room_id)
    .single()

  if (!room) {
    return err('INTERNAL_ERROR', 'Room not found for this game', 500)
  }

  const result = await resolvePlayerOut(
    admin,
    gameId,
    game.room_id,
    userId,
    'SELF_FORFEIT',
    room.capacity,
    room.is_ranked === true
  )

  return ok({
    game_status: result.gameStatus,
    winner_id: result.winnerId,
    next_active_player_id: result.nextActivePlayerId,
  })
})
