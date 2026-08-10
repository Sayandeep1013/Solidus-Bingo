/**
 * Edge Function: start-game
 *
 * Host starts the game in a FULL room.
 *
 * Request body: { room_id: string }
 * Response: { game_id, room_id, active_player_id, game_number }
 *
 * Spec: bingo-edge-functions, bingo-game-mechanics
 * - Only the host can call this
 * - Room must be FULL (not WAITING)
 * - TOCTOU guard via re-check inside operation
 * - Generates unique boards using generateBoards(n) from gameEngine
 * - Creates games, game_players, game_boards rows
 * - Randomly selects first active_player_id
 * - games.status transitions: STARTING → ACTIVE within this function
 *   (STARTING is transient and never observable via Realtime)
 * - rooms.status → IN_GAME
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

// ── Inline game engine (can't import from src/ in Edge Functions) ──────────
function generateBoard(): number[] {
  const board = Array.from({ length: 25 }, (_, i) => i + 1)
  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[board[i], board[j]] = [board[j], board[i]]
  }
  return board
}

function generateBoards(n: number): number[][] {
  const boards: number[][] = []
  const seen = new Set<string>()
  while (boards.length < n) {
    const board = generateBoard()
    const key = board.join(',')
    if (!seen.has(key)) {
      seen.add(key)
      boards.push(board)
    }
  }
  return boards
}

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

  const roomId = body.room_id
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Fetch room ────────────────────────────────────────────────────────────
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('id, status, host_id, capacity, time_bank_ms')
    .eq('id', roomId)
    .single()

  if (roomError || !room) {
    return err('ROOM_NOT_FOUND', 'Room not found', 404)
  }

  // ── Auth check: only host can start ───────────────────────────────────────
  if (room.host_id !== userId) {
    return err('UNAUTHORIZED', 'Only the host can start the game', 403)
  }

  if (room.status === 'WAITING') {
    return err('ROOM_NOT_FULL', 'Room is not full yet', 409)
  }

  if (room.status !== 'FULL') {
    return err('INVALID_STATE_TRANSITION', `Cannot start game from room status: ${room.status}`, 409)
  }

  // ── Check no active game already exists ───────────────────────────────────
  const { data: activeGame } = await admin
    .from('games')
    .select('id')
    .eq('room_id', roomId)
    .in('status', ['LOBBY', 'STARTING', 'ACTIVE'])
    .maybeSingle()

  if (activeGame) {
    return err('GAME_ALREADY_ACTIVE', 'A game is already active in this room', 409)
  }

  // ── Fetch active players in join_order ────────────────────────────────────
  const { data: players, error: playersError } = await admin
    .from('room_players')
    .select('player_id, join_order')
    .eq('room_id', roomId)
    .eq('status', 'ACTIVE')
    .order('join_order', { ascending: true })

  if (playersError || !players || players.length < 2) {
    return err('ROOM_NOT_FULL', 'Not enough active players', 409)
  }

  // ── TOCTOU guard: re-validate room is still FULL ──────────────────────────
  const { data: freshRoom } = await admin
    .from('rooms')
    .select('status')
    .eq('id', roomId)
    .single()

  if (freshRoom?.status !== 'FULL') {
    return err('ROOM_NOT_FULL', 'Room status changed — try again', 409)
  }

  // ── Generate unique boards ────────────────────────────────────────────────
  const n = players.length
  const boards = generateBoards(n)

  // ── Determine game_number (next in sequence for this room) ────────────────
  const { count: gameCount } = await admin
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)

  const gameNumber = (gameCount ?? 0) + 1

  // ── Randomly select first active player ──────────────────────────────────
  const firstPlayerIdx = Math.floor(Math.random() * n)
  const firstPlayerId = players[firstPlayerIdx].player_id

  // ── Insert game row (ACTIVE — STARTING is transient and skipped for Realtime) ──
  // turn_started_at seeds the chess clock for the first active player — spec
  // bingo-disconnect-recovery §3.2. It's a distinct column from started_at
  // (this game's creation time) and from updated_at (bumped by a trigger on
  // every write, which would drift from "when did THIS turn actually begin"
  // after any non-turn-changing update).
  const now = new Date().toISOString()
  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({
      room_id: roomId,
      game_number: gameNumber,
      status: 'ACTIVE',
      active_player_id: firstPlayerId,
      started_at: now,
      turn_started_at: now,
    })
    .select('id')
    .single()

  if (gameError || !game) {
    console.error('[start-game] insert game error:', gameError)
    return err('INTERNAL_ERROR', 'Failed to create game', 500)
  }

  // ── Insert game_players (turn_order = join_order) ─────────────────────────
  const timeBankMs = room.time_bank_ms as number
  const gamePlayers = players.map((p, i) => ({
    game_id: game.id,
    player_id: p.player_id,
    turn_order: i + 1,
    score: 0,
    time_remaining_ms: timeBankMs,
  }))

  const { error: gpError } = await admin.from('game_players').insert(gamePlayers)
  if (gpError) {
    console.error('[start-game] insert game_players error:', gpError)
    await admin.from('games').delete().eq('id', game.id)
    return err('INTERNAL_ERROR', 'Failed to create game players', 500)
  }

  // ── Insert game_boards ────────────────────────────────────────────────────
  const gameBoards = players.map((p, i) => ({
    game_id: game.id,
    player_id: p.player_id,
    layout: boards[i],
  }))

  const { error: gbError } = await admin.from('game_boards').insert(gameBoards)
  if (gbError) {
    console.error('[start-game] insert game_boards error:', gbError)
    await admin.from('games').delete().eq('id', game.id)
    return err('INTERNAL_ERROR', 'Failed to create game boards', 500)
  }

  // ── Transition room to IN_GAME ────────────────────────────────────────────
  await admin
    .from('rooms')
    .update({ status: 'IN_GAME' })
    .eq('id', roomId)

  return ok({
    game_id: game.id,
    room_id: roomId,
    game_number: gameNumber,
    active_player_id: firstPlayerId,
    player_count: n,
    time_bank_ms: timeBankMs,
    turn_started_at: now,
  })
})
