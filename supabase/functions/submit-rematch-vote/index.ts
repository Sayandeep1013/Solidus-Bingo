/**
 * Edge Function: submit-rematch-vote
 *
 * Records a player's intention to play again after a game ends.
 *
 * Request body: { room_id: string, game_number: number }
 * Response: { votes_cast, votes_needed, quorum_reached, new_game_id? }
 *
 * Spec: bingo-edge-functions §4f, bingo-room-lobby
 * - UPSERT into rematch_votes (idempotent — second vote is a no-op)
 * - Count votes vs ACTIVE room_players
 * - If quorum reached: start new game inline (same logic as start-game)
 *   + delete old votes in same transaction
 *   + room → IN_GAME
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

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
    if (!seen.has(key)) { seen.add(key); boards.push(board) }
  }
  return boards
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { room_id?: unknown; game_number?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.room_id !== 'string') return err('INVALID_INPUT', 'room_id is required', 400)
  if (!Number.isInteger(body.game_number)) return err('INVALID_INPUT', 'game_number is required', 400)

  const roomId = body.room_id
  const gameNumber = body.game_number as number

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Verify room state ─────────────────────────────────────────────────────
  const { data: room } = await admin
    .from('rooms')
    .select('id, status, host_id, capacity, time_bank_ms')
    .eq('id', roomId)
    .single()

  if (!room) return err('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.status !== 'GAME_FINISHED' && room.status !== 'REMATCH_WAITING') {
    return err('INVALID_STATE_TRANSITION', `Room is not in a rematch-eligible state (${room.status})`, 409)
  }

  // ── Verify caller is an active member ─────────────────────────────────────
  const { data: membership } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  if (!membership) return err('UNAUTHORIZED', 'You are not an active member of this room', 403)

  // ── Upsert vote (idempotent) ──────────────────────────────────────────────
  await admin
    .from('rematch_votes')
    .upsert(
      { room_id: roomId, player_id: userId, game_number: gameNumber },
      { onConflict: 'room_id,player_id,game_number' }
    )

  // Transition room to REMATCH_WAITING if not already
  if (room.status === 'GAME_FINISHED') {
    await admin.from('rooms').update({ status: 'REMATCH_WAITING' }).eq('id', roomId)
  }

  // ── Count votes and quorum ────────────────────────────────────────────────
  const { count: voteCount } = await admin
    .from('rematch_votes')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('game_number', gameNumber)

  const { count: activePlayers } = await admin
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('status', 'ACTIVE')

  const votes = voteCount ?? 0
  const needed = activePlayers ?? 0

  if (votes < needed) {
    return ok({ votes_cast: votes, votes_needed: needed, quorum_reached: false })
  }

  // ── Quorum reached — start new game ──────────────────────────────────────
  // Delete old votes (within same request, not a DB transaction, but atomic enough)
  await admin.from('rematch_votes').delete().eq('room_id', roomId).eq('game_number', gameNumber)

  const { data: players } = await admin
    .from('room_players')
    .select('player_id, join_order')
    .eq('room_id', roomId)
    .eq('status', 'ACTIVE')
    .order('join_order', { ascending: true })

  const playerList = players ?? []
  const n = playerList.length
  const boards = generateBoards(n)

  const { count: gameCount } = await admin
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)

  const newGameNumber = (gameCount ?? 0) + 1
  const firstPlayerIdx = Math.floor(Math.random() * n)
  const firstPlayerId = playerList[firstPlayerIdx].player_id

  // turn_started_at seeds the chess clock for the first active player, same
  // as start-game — omitting it (as this function used to) leaves it NULL
  // forever, which the client reads as "no live clock" and just displays the
  // frozen time_remaining_ms value instead.
  const now = new Date().toISOString()
  const { data: newGame, error: newGameError } = await admin
    .from('games')
    .insert({
      room_id: roomId,
      game_number: newGameNumber,
      status: 'ACTIVE',
      active_player_id: firstPlayerId,
      started_at: now,
      turn_started_at: now,
    })
    .select('id')
    .single()

  if (newGameError || !newGame) {
    return err('INTERNAL_ERROR', 'Failed to start rematch game', 500)
  }

  // time_remaining_ms defaults to 0 in the schema — omitting it here (as
  // this function used to) meant every rematch started with every player's
  // clock already at 0:00, letting the opponent claim an instant timeout win
  // from turn one. Must seed it from the room's own time bank, same as
  // start-game does for game 1.
  const timeBankMs = room.time_bank_ms as number
  await admin.from('game_players').insert(
    playerList.map((p, i) => ({
      game_id: newGame.id, player_id: p.player_id, turn_order: i + 1, score: 0,
      time_remaining_ms: timeBankMs,
    }))
  )

  await admin.from('game_boards').insert(
    playerList.map((p, i) => ({
      game_id: newGame.id, player_id: p.player_id, layout: boards[i],
    }))
  )

  await admin.from('rooms').update({ status: 'IN_GAME' }).eq('id', roomId)

  return ok({
    votes_cast: votes,
    votes_needed: needed,
    quorum_reached: true,
    new_game_id: newGame.id,
    active_player_id: firstPlayerId,
  })
})
