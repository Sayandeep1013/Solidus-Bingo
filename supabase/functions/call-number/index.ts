/**
 * Edge Function: call-number (most complex)
 *
 * The active player calls a number. Validates, scores, checks win/draw.
 *
 * Request body: { game_id, number, sequence }
 * Response: { game_status, next_active_player_id?, winner_id?, winning_call?,
 *             newly_completed_lines, updated_scores, called_number }
 *
 * Spec: bingo-edge-functions §4e, bingo-game-mechanics §Req 3–5, 7
 *
 * Paths:
 *   Continue Path  — game stays ACTIVE, turn advances
 *   Win Path       — score >= 5, game → FINISHED, room → GAME_FINISHED
 *   Draw Path      — sequence === 25, no winner, game → ABANDONED
 *
 * Critical Win Path ordering (from spec):
 *   1. Capture active_player_id FIRST (before any nulling)
 *   2. Set active_player_id = NULL
 *   3. Set winner_id = captured value
 *
 * Idempotency:
 *   Same (game_id + number + sequence + caller) → return original result, no re-apply
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

// ── Inline line detection (mirrors gameEngine.ts) ─────────────────────────
type LineId =
  | 'row_0' | 'row_1' | 'row_2' | 'row_3' | 'row_4'
  | 'col_0' | 'col_1' | 'col_2' | 'col_3' | 'col_4'
  | 'diag_main' | 'diag_anti'

const ALL_LINE_IDS: LineId[] = [
  'row_0', 'row_1', 'row_2', 'row_3', 'row_4',
  'col_0', 'col_1', 'col_2', 'col_3', 'col_4',
  'diag_main', 'diag_anti',
]

function getLineIndices(lineId: LineId): number[] {
  if (lineId.startsWith('row_')) {
    const r = parseInt(lineId.slice(4), 10)
    return [0, 1, 2, 3, 4].map((c) => r * 5 + c)
  }
  if (lineId.startsWith('col_')) {
    const c = parseInt(lineId.slice(4), 10)
    return [0, 1, 2, 3, 4].map((r) => r * 5 + c)
  }
  if (lineId === 'diag_main') return [0, 6, 12, 18, 24]
  if (lineId === 'diag_anti') return [4, 8, 12, 16, 20]
  throw new Error(`Unknown lineId: ${lineId}`)
}

function evaluateNewLines(
  board: number[],
  calledSet: Set<number>,
  alreadyCompleted: Set<LineId>
): LineId[] {
  return ALL_LINE_IDS.filter((lineId) => {
    if (alreadyCompleted.has(lineId)) return false
    return getLineIndices(lineId).every((idx) => calledSet.has(board[idx]))
  })
}

function advanceTurn(
  players: { player_id: string; turn_order: number }[],
  currentPlayerId: string
): string {
  const sorted = [...players].sort((a, b) => a.turn_order - b.turn_order)
  const idx = sorted.findIndex((p) => p.player_id === currentPlayerId)
  return sorted[(idx + 1) % sorted.length].player_id
}

/**
 * Increments player_stats for a finished Ranked_Game. Only ever called when
 * the room's is_ranked flag (re-verified from the DB, never trusted from a
 * cache) is true — spec bingo-leaderboard §Req 1, 4. Normal-room games never
 * reach this function at all, which is what makes the leaderboard
 * structurally immune to normal-room manipulation.
 *
 * Uses read-then-write rather than an atomic SQL increment (no RPC
 * functions elsewhere in this codebase to justify introducing one here) —
 * safe in practice because a player can only ever be active in one game at
 * a time (join-queue rejects queueing while IN_GAME), so this player's own
 * row can never be written concurrently by two finishing games.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeRankedStats(admin: any, playerIds: string[], winnerId: string | null) {
  for (const playerId of playerIds) {
    const { data: existing } = await admin
      .from('player_stats')
      .select('games_played, games_won')
      .eq('player_id', playerId)
      .maybeSingle()

    const gamesPlayed = (existing?.games_played ?? 0) + 1
    const gamesWon = (existing?.games_won ?? 0) + (playerId === winnerId ? 1 : 0)

    const { error } = await admin
      .from('player_stats')
      .upsert({ player_id: playerId, games_played: gamesPlayed, games_won: gamesWon }, { onConflict: 'player_id' })

    if (error) console.error('[call-number] finalizeRankedStats upsert error:', playerId, error)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { game_id?: unknown; number?: unknown; sequence?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  const { game_id, number: num, sequence } = body

  // ── Pre-DB validation ─────────────────────────────────────────────────────
  if (typeof game_id !== 'string') {
    return err('INVALID_INPUT', 'game_id is required', 400)
  }
  if (!Number.isInteger(num) || (num as number) < 1 || (num as number) > 25) {
    return err('INVALID_NUMBER', 'number must be an integer between 1 and 25', 400)
  }
  if (!Number.isInteger(sequence) || (sequence as number) < 1) {
    return err('INVALID_INPUT', 'sequence must be a positive integer', 400)
  }

  const calledNumber = num as number
  const callSequence = sequence as number

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Fetch game ────────────────────────────────────────────────────────────
  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id, room_id, status, active_player_id, winner_id')
    .eq('id', game_id)
    .single()

  if (gameError || !game) {
    return err('GAME_NOT_FOUND', 'Game not found', 404)
  }

  // Re-verified from the DB on every call — never trust a client-passed or
  // cached flag for whether this game's outcome should touch the leaderboard.
  const { data: room } = await admin
    .from('rooms')
    .select('is_ranked')
    .eq('id', game.room_id)
    .single()
  const isRanked = room?.is_ranked === true

  if (game.status === 'FINISHED' || game.status === 'ABANDONED' || game.status === 'CANCELLED') {
    return err('GAME_FINISHED', 'Game is already finished', 409)
  }

  if (game.status !== 'ACTIVE') {
    return err('GAME_NOT_ACTIVE', `Game is not active (status: ${game.status})`, 409)
  }

  // ── Turn check ────────────────────────────────────────────────────────────
  if (game.active_player_id !== userId) {
    return err('NOT_YOUR_TURN', 'It is not your turn', 403)
  }

  // ── Idempotency check (pre-lock) ──────────────────────────────────────────
  const { data: existingCall } = await admin
    .from('game_calls')
    .select('id, sequence, number')
    .eq('game_id', game_id)
    .eq('caller_id', userId)
    .eq('number', calledNumber)
    .eq('sequence', callSequence)
    .maybeSingle()

  if (existingCall) {
    // Duplicate request — return original successful result payload (spec req 7.6)
    const { data: gpRows } = await admin
      .from('game_players')
      .select('player_id, score')
      .eq('game_id', game_id)

    const scores: Record<string, number> = {}
    for (const row of gpRows ?? []) scores[row.player_id] = row.score

    return ok({
      duplicate: true,
      called_number: calledNumber,
      sequence: callSequence,
      game_status: game.status,
      winner_id: game.winner_id ?? null,
      next_active_player_id: game.active_player_id,
      newly_completed_lines: [],
      updated_scores: scores,
    })
  }

  // ── Check number not already called ──────────────────────────────────────
  const { data: dupNumber } = await admin
    .from('game_calls')
    .select('id')
    .eq('game_id', game_id)
    .eq('number', calledNumber)
    .maybeSingle()

  if (dupNumber) {
    return err('NUMBER_ALREADY_CALLED', `Number ${calledNumber} has already been called`, 409)
  }

  // ── Sequence validation ───────────────────────────────────────────────────
  const { count: existingCallCount } = await admin
    .from('game_calls')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game_id)

  const expectedSequence = (existingCallCount ?? 0) + 1
  if (callSequence !== expectedSequence) {
    return err('CONCURRENT_CONFLICT', `Expected sequence ${expectedSequence}, got ${callSequence}`, 409)
  }

  // ── Insert game_call ──────────────────────────────────────────────────────
  const { error: callInsertError } = await admin
    .from('game_calls')
    .insert({
      game_id,
      caller_id: userId,
      number: calledNumber,
      sequence: callSequence,
    })

  if (callInsertError) {
    // Unique constraint violation = concurrent call beat us
    if (callInsertError.code === '23505') {
      return err('CONCURRENT_CONFLICT', 'Concurrent call conflict — retry', 409)
    }
    console.error('[call-number] insert call error:', callInsertError)
    return err('INTERNAL_ERROR', 'Failed to record call', 500)
  }

  // ── Fetch all boards + existing completed lines ───────────────────────────
  const [{ data: gameBoards }, { data: gamePlayers }, { data: existingLines }] =
    await Promise.all([
      admin.from('game_boards').select('player_id, layout').eq('game_id', game_id),
      admin.from('game_players').select('player_id, score, turn_order').eq('game_id', game_id),
      admin.from('game_completed_lines').select('player_id, line_id').eq('game_id', game_id),
    ])

  // ── Build called set for this game ────────────────────────────────────────
  const { data: allCalls } = await admin
    .from('game_calls')
    .select('number')
    .eq('game_id', game_id)

  const calledSet = new Set<number>((allCalls ?? []).map((c) => c.number as number))

  // ── Evaluate new lines for each player ────────────────────────────────────
  const alreadyCompletedByPlayer = new Map<string, Set<LineId>>()
  for (const line of existingLines ?? []) {
    if (!alreadyCompletedByPlayer.has(line.player_id)) {
      alreadyCompletedByPlayer.set(line.player_id, new Set())
    }
    alreadyCompletedByPlayer.get(line.player_id)!.add(line.line_id as LineId)
  }

  const newlyCompletedLines: Array<{ player_id: string; line_id: LineId }> = []
  for (const board of gameBoards ?? []) {
    const layout = board.layout as number[]
    const already = alreadyCompletedByPlayer.get(board.player_id) ?? new Set<LineId>()
    const newLines = evaluateNewLines(layout, calledSet, already)
    for (const lineId of newLines) {
      newlyCompletedLines.push({ player_id: board.player_id, line_id: lineId })
    }
  }

  // ── Insert new completed lines ────────────────────────────────────────────
  if (newlyCompletedLines.length > 0) {
    const lineRows = newlyCompletedLines.map((l) => ({
      game_id,
      player_id: l.player_id,
      line_id: l.line_id,
      completing_call_sequence: callSequence,
    }))
    const { error: lineError } = await admin.from('game_completed_lines').insert(lineRows)
    if (lineError && lineError.code !== '23505') {
      console.error('[call-number] insert lines error:', lineError)
    }
  }

  // ── Update scores ─────────────────────────────────────────────────────────
  const scoreDeltas = new Map<string, number>()
  for (const { player_id } of newlyCompletedLines) {
    scoreDeltas.set(player_id, (scoreDeltas.get(player_id) ?? 0) + 1)
  }

  const updatedScores: Record<string, number> = {}
  for (const gp of gamePlayers ?? []) {
    const delta = scoreDeltas.get(gp.player_id) ?? 0
    updatedScores[gp.player_id] = gp.score + delta
    if (delta > 0) {
      await admin
        .from('game_players')
        .update({ score: gp.score + delta })
        .eq('game_id', game_id)
        .eq('player_id', gp.player_id)
    }
  }

  // ── Win check ─────────────────────────────────────────────────────────────
  const winnerExists = Object.values(updatedScores).some((s) => s >= 5)

  if (winnerExists) {
    // Win Path — CRITICAL ordering (spec §4e):
    const captured_winner_id = game.active_player_id // 1. capture FIRST

    await admin
      .from('games')
      .update({
        active_player_id: null,              // 2. null it second
        winner_id: captured_winner_id,       // 3. set winner third
        winning_call: calledNumber,
        status: 'FINISHED',
        finished_at: new Date().toISOString(),
      })
      .eq('id', game_id)

    // Insert game_results
    await admin.from('game_results').insert({
      game_id,
      winner_id: captured_winner_id,
      outcome: 'WINNER',
      final_scores: updatedScores,
      total_calls: callSequence,
    })

    // Transition room
    await admin
      .from('rooms')
      .update({ status: 'GAME_FINISHED' })
      .eq('id', game.room_id)

    if (isRanked) {
      await finalizeRankedStats(admin, Object.keys(updatedScores), captured_winner_id)
    }

    return ok({
      called_number: calledNumber,
      sequence: callSequence,
      game_status: 'FINISHED',
      winner_id: captured_winner_id,
      winning_call: calledNumber,
      next_active_player_id: null,
      newly_completed_lines: newlyCompletedLines,
      updated_scores: updatedScores,
    })
  }

  // ── Draw check (all 25 called, no winner) ─────────────────────────────────
  if (callSequence === 25) {
    await admin
      .from('games')
      .update({
        active_player_id: null,
        status: 'ABANDONED',
        finished_at: new Date().toISOString(),
      })
      .eq('id', game_id)

    await admin.from('game_results').insert({
      game_id,
      winner_id: null,
      outcome: 'ABANDONED',
      final_scores: updatedScores,
      total_calls: 25,
    })

    await admin
      .from('rooms')
      .update({ status: 'GAME_FINISHED' })
      .eq('id', game.room_id)

    if (isRanked) {
      await finalizeRankedStats(admin, Object.keys(updatedScores), null)
    }

    return ok({
      called_number: calledNumber,
      sequence: callSequence,
      game_status: 'ABANDONED',
      winner_id: null,
      next_active_player_id: null,
      newly_completed_lines: newlyCompletedLines,
      updated_scores: updatedScores,
    })
  }

  // ── Continue Path — advance turn ──────────────────────────────────────────
  const nextPlayerId = advanceTurn(gamePlayers ?? [], userId)

  await admin
    .from('games')
    .update({ active_player_id: nextPlayerId })
    .eq('id', game_id)

  return ok({
    called_number: calledNumber,
    sequence: callSequence,
    game_status: 'ACTIVE',
    winner_id: null,
    next_active_player_id: nextPlayerId,
    newly_completed_lines: newlyCompletedLines,
    updated_scores: updatedScores,
  })
})
