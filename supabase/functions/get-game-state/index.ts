/**
 * Edge Function: get-game-state
 *
 * Returns a full snapshot of the current game state for reconnection.
 *
 * Request body: { game_id?: string, room_id?: string }
 * At least one is required. If only room_id: finds the most recent active game.
 *
 * Response: full game snapshot (caller's board only — boards are private)
 *
 * Spec: bingo-edge-functions §4g
 * - READ COMMITTED snapshot only — no write locks
 * - Returns caller's own board, all calls ordered by sequence,
 *   all completed lines, scores, active_player_id, game_status
 * - Does NOT return other players' board layouts
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { game_id?: unknown; room_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (!body.game_id && !body.room_id) {
    return err('INVALID_INPUT', 'Either game_id or room_id is required', 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Resolve game_id ───────────────────────────────────────────────────────
  let gameId = typeof body.game_id === 'string' ? body.game_id : null

  if (!gameId && typeof body.room_id === 'string') {
    // Find highest game_number that is active or recently finished
    const { data: latestGame } = await admin
      .from('games')
      .select('id')
      .eq('room_id', body.room_id)
      .in('status', ['ACTIVE', 'FINISHED', 'ABANDONED'])
      .order('game_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestGame) {
      return err('GAME_NOT_FOUND', 'No active or recent game found for this room', 404)
    }
    gameId = latestGame.id
  }

  if (!gameId) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  // ── Fetch game ────────────────────────────────────────────────────────────
  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id, room_id, status, active_player_id, winner_id, winning_call, game_number, started_at, finished_at, turn_started_at')
    .eq('id', gameId)
    .single()

  if (gameError || !game) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  // ── Verify caller is a member of this room ────────────────────────────────
  const { data: membership } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', game.room_id)
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  if (!membership) {
    return err('UNAUTHORIZED', 'You are not a member of this room', 403)
  }

  // ── Fetch all data in parallel (READ COMMITTED, no locks) ─────────────────
  const [
    { data: myBoard },
    { data: calls },
    { data: players },
    { data: completedLines },
    { data: gameResult },
  ] = await Promise.all([
    // Caller's board only — boards are private per spec
    admin
      .from('game_boards')
      .select('layout')
      .eq('game_id', gameId)
      .eq('player_id', userId)
      .maybeSingle(),

    // Full call history ordered by sequence
    admin
      .from('game_calls')
      .select('number, sequence, caller_id, called_at')
      .eq('game_id', gameId)
      .order('sequence', { ascending: true }),

    // All players' scores, turn orders, remaining time bank, and rotation state
    admin
      .from('game_players')
      .select('player_id, score, turn_order, time_remaining_ms, is_out, bot_controlled')
      .eq('game_id', gameId),

    // All completed lines (all players — needed for board rendering)
    admin
      .from('game_completed_lines')
      .select('player_id, line_id, completing_call_sequence')
      .eq('game_id', gameId),

    // Game result if finished
    admin
      .from('game_results')
      .select('outcome, winner_id, final_scores, total_calls')
      .eq('game_id', gameId)
      .maybeSingle(),
  ])

  // ── Build scores map ──────────────────────────────────────────────────────
  const scores: Record<string, number> = {}
  const turnOrders: Record<string, number> = {}
  const timeRemainingMs: Record<string, number> = {}
  const outPlayers: Record<string, boolean> = {}
  const botControlled: Record<string, boolean> = {}
  for (const gp of players ?? []) {
    scores[gp.player_id] = gp.score
    turnOrders[gp.player_id] = gp.turn_order
    timeRemainingMs[gp.player_id] = gp.time_remaining_ms
    outPlayers[gp.player_id] = gp.is_out
    botControlled[gp.player_id] = gp.bot_controlled
  }

  // ── Build completed lines grouped by player ───────────────────────────────
  const linesByPlayer: Record<string, string[]> = {}
  for (const line of completedLines ?? []) {
    if (!linesByPlayer[line.player_id]) linesByPlayer[line.player_id] = []
    linesByPlayer[line.player_id].push(line.line_id)
  }

  return ok({
    game_id: game.id,
    room_id: game.room_id,
    game_number: game.game_number,
    status: game.status,
    active_player_id: game.active_player_id,
    winner_id: game.winner_id,
    winning_call: game.winning_call,
    started_at: game.started_at,
    finished_at: game.finished_at,
    turn_started_at: game.turn_started_at,

    // Caller's private board (null if game not yet started)
    my_board: myBoard?.layout ?? null,

    // Public data
    calls: (calls ?? []).map((c) => ({
      number: c.number,
      sequence: c.sequence,
      caller_id: c.caller_id,
      called_at: c.called_at,
    })),

    scores,
    turn_orders: turnOrders,
    time_remaining_ms: timeRemainingMs,
    out_players: outPlayers,
    bot_controlled: botControlled,
    completed_lines: linesByPlayer,

    // Result (only present when game is finished)
    result: gameResult ?? null,
  })
})
