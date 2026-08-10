/**
 * Edge Function: submit-bot-move
 *
 * Plays one move on behalf of a bot-controlled seat (spec
 * bingo-disconnect-recovery §3.5, design.md §1.2). Nowhere persistent runs
 * the bot — any present, genuine player's client, on noticing via Realtime
 * that the active seat is bot_controlled, waits a short randomized "thinking"
 * delay (mirroring the local practice-bot) and calls this. If two clients
 * race for the same bot turn, that's the same CONCURRENT_CONFLICT race
 * call-number already handles via resolveCall's sequence check — not a new
 * problem.
 *
 * Request body: { game_id }
 * Response: same shape as call-number's (game_status, next_active_player_id,
 *           winner_id, winning_call, newly_completed_lines, updated_scores)
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.5,
 * design.md §1.2, §3, §5
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolveCall } from '../_shared/resolveCall.ts'

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
    .select('id, status, active_player_id')
    .eq('id', gameId)
    .single()

  if (gameError || !game) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  if (game.status !== 'ACTIVE') {
    return err('GAME_NOT_ACTIVE', `Game is not active (status: ${game.status})`, 409)
  }

  if (!game.active_player_id) {
    return err('NO_ACTIVE_PLAYER', 'Game has no active player right now', 409)
  }

  const { data: gamePlayers } = await admin
    .from('game_players')
    .select('player_id, is_out, bot_controlled')
    .eq('game_id', gameId)

  // Only a genuinely present, still-in-rotation player can drive a bot's
  // move — prevents an outside caller (or the bot's own future reconnect
  // race) from puppeting a seat that isn't actually bot_controlled.
  const caller = (gamePlayers ?? []).find((p) => p.player_id === userId)
  if (!caller || caller.is_out) {
    return err('FORBIDDEN', 'You are not an active player in this game', 403)
  }

  const activeSeat = (gamePlayers ?? []).find((p) => p.player_id === game.active_player_id)
  if (!activeSeat || !activeSeat.bot_controlled) {
    return err('NOT_BOT_CONTROLLED', 'The active seat is not bot-controlled', 409)
  }
  const botPlayerId = activeSeat.player_id

  const { data: calls } = await admin
    .from('game_calls')
    .select('number')
    .eq('game_id', gameId)

  const calledSet = new Set<number>((calls ?? []).map((c: { number: number }) => c.number))
  const uncalled = Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !calledSet.has(n))

  if (uncalled.length === 0) {
    // Every number has already been called — the draw path should have
    // already ended the game; nothing left for the bot to play.
    return err('INTERNAL_ERROR', 'No uncalled numbers remain', 500)
  }

  const randomNumber = uncalled[Math.floor(Math.random() * uncalled.length)]
  const nextSequence = calledSet.size + 1

  const result = await resolveCall(admin, gameId, botPlayerId, randomNumber, nextSequence)

  if (!result.ok) {
    return err(result.code, result.message, result.status)
  }
  return ok(result.data)
})
