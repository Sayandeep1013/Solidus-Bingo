/**
 * Edge Function: join-queue
 *
 * Enters the caller into the ranked matchmaking queue for a chosen party
 * size (2, 3, or 4) *and* time bank, and, if enough players are now waiting
 * for that same combination, atomically creates a Ranked_Room + ACTIVE game
 * for the match and skips straight past the lobby (spec
 * bingo-ranked-matchmaking §Req 1-3).
 *
 * Matching is 2-dimensional as of bingo-disconnect-recovery §4 — capacity
 * AND time_bank_ms both have to match, the same way chess.com buckets by
 * time control. This can mean longer queue waits for uncommon time bank
 * choices; no fuzzy/closest-match fallback in this phase (accepted
 * tradeoff, see that spec's Open Question 3).
 *
 * Request body: { capacity: 2 | 3 | 4, time_bank_ms: number }
 * Response: { matched: false, queue_id } while still searching, or
 *           { matched: true, room_id, game_id } the instant a match forms.
 *
 * Concurrency note: this project's Edge Functions never use Postgres RPCs —
 * every other function (create-room, join-room, start-game, ...) does its
 * work as a sequence of plain admin-client queries, so this follows the
 * same style rather than introducing a PL/pgSQL function. Safety instead
 * comes from a conditional UPDATE ... WHERE status = 'WAITING' claim step:
 * if two concurrent join-queue calls try to claim overlapping queue rows,
 * only the request whose UPDATE actually flips all `capacity` rows from
 * WAITING → MATCHED wins; the other detects a short claimed-count and backs
 * off (reverting any rows it did manage to grab back to WAITING). Given
 * this app's realistic scale (a handful of concurrent friends, not a
 * public matchmaking pool), that's sufficient without needing a DB-side
 * transaction/lock the rest of the codebase doesn't otherwise use.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

const QUEUE_EXPIRY_MS = 60_000

/** 3 / 5 / 10 / 15 / 30 minutes — same presets offered at room creation. */
const VALID_TIME_BANKS_MS = [180_000, 300_000, 600_000, 900_000, 1_800_000]

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

  let body: { capacity?: unknown; time_bank_ms?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  const capacity = body.capacity
  if (capacity !== 2 && capacity !== 3 && capacity !== 4) {
    return err('INVALID_CAPACITY', 'capacity must be 2, 3, or 4', 400)
  }

  const timeBankMs = body.time_bank_ms
  if (!VALID_TIME_BANKS_MS.includes(timeBankMs as number)) {
    return err('INVALID_TIME_BANK', `time_bank_ms must be one of: ${VALID_TIME_BANKS_MS.join(', ')}`, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Opportunistic cleanup of stale queue entries (spec Req 4.5) ────────────
  await admin
    .from('matchmaking_queue')
    .delete()
    .eq('status', 'WAITING')
    .lt('queued_at', new Date(Date.now() - QUEUE_EXPIRY_MS).toISOString())

  // ── Reject if already queued ────────────────────────────────────────────────
  const { data: existingQueue } = await admin
    .from('matchmaking_queue')
    .select('id')
    .eq('player_id', userId)
    .eq('status', 'WAITING')
    .maybeSingle()

  if (existingQueue) {
    return err('ALREADY_QUEUED', 'You are already searching for a match', 409)
  }

  // ── Reject if already active in a game ──────────────────────────────────────
  const { data: activeMemberships } = await admin
    .from('room_players')
    .select('rooms(status)')
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')

  const alreadyInGame = (activeMemberships ?? []).some(
    (m) => (m.rooms as unknown as { status: string } | null)?.status === 'IN_GAME'
  )
  if (alreadyInGame) {
    return err('ALREADY_IN_GAME', 'You are already in an active game', 409)
  }

  // ── Insert my queue entry ───────────────────────────────────────────────────
  const { data: myEntry, error: insertError } = await admin
    .from('matchmaking_queue')
    .insert({ player_id: userId, capacity, time_bank_ms: timeBankMs })
    .select('id, queued_at')
    .single()

  if (insertError || !myEntry) {
    if (insertError?.code === '23505') {
      return err('ALREADY_QUEUED', 'You are already searching for a match', 409)
    }
    console.error('[join-queue] insert error:', insertError)
    return err('INTERNAL_ERROR', 'Failed to join queue', 500)
  }

  // ── Try to form a match: oldest `capacity` WAITING entries for this size
  // AND time bank — both dimensions have to match, see header comment ───────
  const { data: waiting } = await admin
    .from('matchmaking_queue')
    .select('id, player_id, queued_at')
    .eq('capacity', capacity)
    .eq('time_bank_ms', timeBankMs)
    .eq('status', 'WAITING')
    .order('queued_at', { ascending: true })
    .limit(capacity)

  if (!waiting || waiting.length < capacity) {
    return ok({ matched: false, queue_id: myEntry.id })
  }

  // ── Claim step: only rows still WAITING actually flip to MATCHED ───────────
  const candidateIds = waiting.map((w) => w.id)
  const { data: claimed, error: claimError } = await admin
    .from('matchmaking_queue')
    .update({ status: 'MATCHED' })
    .in('id', candidateIds)
    .eq('status', 'WAITING')
    .select('id, player_id, queued_at')

  if (claimError) {
    console.error('[join-queue] claim error:', claimError)
    return ok({ matched: false, queue_id: myEntry.id })
  }

  if (!claimed || claimed.length !== capacity) {
    // Lost the race to another concurrent join-queue call — release whatever
    // we did manage to claim back to WAITING so it's available for the next
    // attempt (by us or anyone else).
    if (claimed && claimed.length > 0) {
      await admin
        .from('matchmaking_queue')
        .update({ status: 'WAITING' })
        .in('id', claimed.map((c) => c.id))
    }
    return ok({ matched: false, queue_id: myEntry.id })
  }

  // ── We now own exactly `capacity` matched players — create the Ranked_Room ──
  const orderedPlayers = [...claimed].sort(
    (a, b) => new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime()
  )
  const n = orderedPlayers.length
  const boards = generateBoards(n)

  const { data: room, error: roomError } = await admin
    .from('rooms')
    .insert({
      code: null,
      is_ranked: true,
      host_id: orderedPlayers[0].player_id,
      capacity: n,
      status: 'FULL',
      time_bank_ms: timeBankMs,
    })
    .select('id')
    .single()

  if (roomError || !room) {
    console.error('[join-queue] room create error:', roomError)
    // Revert claims so these players can be matched again
    await admin.from('matchmaking_queue').update({ status: 'WAITING' }).in('id', candidateIds)
    return err('INTERNAL_ERROR', 'Failed to create ranked room', 500)
  }

  await admin.from('room_players').insert(
    orderedPlayers.map((p, i) => ({
      room_id: room.id, player_id: p.player_id, join_order: i + 1, status: 'ACTIVE',
    }))
  )

  const firstPlayerIdx = Math.floor(Math.random() * n)
  const now = new Date().toISOString()

  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({
      room_id: room.id,
      game_number: 1,
      status: 'ACTIVE',
      active_player_id: orderedPlayers[firstPlayerIdx].player_id,
      started_at: now,
      turn_started_at: now,
    })
    .select('id')
    .single()

  if (gameError || !game) {
    console.error('[join-queue] game create error:', gameError)
    return err('INTERNAL_ERROR', 'Failed to start ranked game', 500)
  }

  await admin.from('game_players').insert(
    orderedPlayers.map((p, i) => ({
      game_id: game.id, player_id: p.player_id, turn_order: i + 1, score: 0, time_remaining_ms: timeBankMs,
    }))
  )
  await admin.from('game_boards').insert(
    orderedPlayers.map((p, i) => ({ game_id: game.id, player_id: p.player_id, layout: boards[i] }))
  )
  await admin.from('rooms').update({ status: 'IN_GAME' }).eq('id', room.id)
  await admin.from('matchmaking_queue').update({ matched_room_id: room.id }).in('id', candidateIds)

  return ok({ matched: true, room_id: room.id, game_id: game.id })
})
