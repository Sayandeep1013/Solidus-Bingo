/**
 * Edge Function: claim-timeout-win
 *
 * Replaces claim-forfeit-win's flat 2-minute "assume they're gone" heuristic
 * with a precise, objective check: has the currently-active player's own
 * chess-clock time bank actually run out? Any other present player can
 * report this, but the server always re-derives the true elapsed time from
 * its own stored games.turn_started_at — never trusting the caller's claim
 * that time is up — so a client can't force a false win through.
 *
 * Request body: { game_id }
 * Response: { game_status, winner_id, next_active_player_id }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.2,
 * design.md §1.1 and §5 (this supersedes claim-forfeit-win, which stays
 * deployed but unused rather than deleted outright)
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
    .select('id, room_id, status, active_player_id, turn_started_at')
    .eq('id', gameId)
    .single()

  if (gameError || !game) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  if (game.status !== 'ACTIVE') {
    return err('GAME_NOT_ACTIVE', `Game is not active (status: ${game.status})`, 409)
  }

  if (!game.active_player_id) {
    return err('NO_ACTIVE_PLAYER', 'Game has no active player to claim against', 409)
  }

  const { data: gamePlayers } = await admin
    .from('game_players')
    .select('player_id, time_remaining_ms')
    .eq('game_id', gameId)

  const isPlayerInGame = (gamePlayers ?? []).some((p) => p.player_id === userId)
  if (!isPlayerInGame) {
    return err('FORBIDDEN', 'You are not a player in this game', 403)
  }

  if (game.active_player_id === userId) {
    return err('NOT_STALLED', "It's your own turn — you can't claim a timeout on yourself", 409)
  }

  const activePlayer = (gamePlayers ?? []).find((p) => p.player_id === game.active_player_id)
  if (!activePlayer) {
    return err('INTERNAL_ERROR', 'Active player has no game_players row', 500)
  }

  const elapsedMs = Date.now() - new Date(game.turn_started_at).getTime()
  if (elapsedMs < activePlayer.time_remaining_ms) {
    const remainingSec = Math.ceil((activePlayer.time_remaining_ms - elapsedMs) / 1000)
    return err('TOO_SOON', `Opponent still has ${remainingSec}s on their clock`, 409)
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
    game.active_player_id,
    'TIMEOUT',
    room.capacity,
    room.is_ranked === true
  )

  return ok({
    game_status: result.gameStatus,
    winner_id: result.winnerId,
    next_active_player_id: result.nextActivePlayerId,
  })
})
