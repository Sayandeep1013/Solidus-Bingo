/**
 * supabase/functions/_shared/resolveCall.ts
 *
 * The actual scoring/line-detection/win-check body of call-number, extracted
 * so submit-bot-move can call it too instead of duplicating ~150 lines —
 * spec .kiro/specs/bingo-disconnect-recovery/design.md §3. Parameterized by
 * `callerId` rather than reading the authenticated user directly: for a real
 * player's move that's their own id; for a bot-controlled seat's move it's
 * the bot-controlled player_id, attributed exactly like a human call so
 * their board accumulates lines/calls normally (design.md §1.2) — the
 * *caller* of submit-bot-move is a different, merely-present human whose
 * own id never appears in the resulting game_calls row.
 *
 * Callers (call-number, submit-bot-move) are responsible for:
 *   - authenticating the real caller and validating the request shape
 *   - deciding what `callerId` should be (their own id, or a bot's seat)
 *   - deciding what `calledNumber`/`callSequence` should be (client-supplied
 *     for a human call; server-computed for a bot move)
 *   - mapping this function's result to an HTTP response via ok()/err()
 */
import { finalizeRankedStats } from './finalizeRankedStats.ts'
import { resolvePlayerOut } from './resolvePlayerOut.ts'

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

/** Skips is_out players when computing whose turn is next. */
function advanceTurn(
  players: { player_id: string; turn_order: number; is_out?: boolean }[],
  currentPlayerId: string
): string {
  const sorted = [...players].sort((a, b) => a.turn_order - b.turn_order)
  const idx = sorted.findIndex((p) => p.player_id === currentPlayerId)
  for (let step = 1; step <= sorted.length; step++) {
    const candidate = sorted[(idx + step) % sorted.length]
    if (!candidate.is_out) return candidate.player_id
  }
  return currentPlayerId // unreachable in practice — the caller is always non-out
}

export type ResolveCallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string; status: number }

export async function resolveCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  gameId: string,
  callerId: string,
  calledNumber: number,
  callSequence: number
): Promise<ResolveCallResult> {
  // ── Fetch game ────────────────────────────────────────────────────────────
  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id, room_id, status, active_player_id, winner_id, turn_started_at')
    .eq('id', gameId)
    .single()

  if (gameError || !game) {
    return { ok: false, code: 'GAME_NOT_FOUND', message: 'Game not found', status: 404 }
  }

  // Re-verified from the DB on every call — never trust a client-passed or
  // cached flag for whether this game's outcome should touch the leaderboard.
  const { data: room } = await admin
    .from('rooms')
    .select('is_ranked, capacity')
    .eq('id', game.room_id)
    .single()
  const isRanked = room?.is_ranked === true

  if (game.status === 'FINISHED' || game.status === 'ABANDONED' || game.status === 'CANCELLED') {
    return { ok: false, code: 'GAME_FINISHED', message: 'Game is already finished', status: 409 }
  }

  if (game.status !== 'ACTIVE') {
    return { ok: false, code: 'GAME_NOT_ACTIVE', message: `Game is not active (status: ${game.status})`, status: 409 }
  }

  // ── Turn check ────────────────────────────────────────────────────────────
  if (game.active_player_id !== callerId) {
    return { ok: false, code: 'NOT_YOUR_TURN', message: 'It is not your turn', status: 403 }
  }

  // ── Idempotency check (pre-lock) ──────────────────────────────────────────
  const { data: existingCall } = await admin
    .from('game_calls')
    .select('id, sequence, number')
    .eq('game_id', gameId)
    .eq('caller_id', callerId)
    .eq('number', calledNumber)
    .eq('sequence', callSequence)
    .maybeSingle()

  if (existingCall) {
    const { data: gpRows } = await admin
      .from('game_players')
      .select('player_id, score')
      .eq('game_id', gameId)

    const scores: Record<string, number> = {}
    for (const row of gpRows ?? []) scores[row.player_id] = row.score

    return {
      ok: true,
      data: {
        duplicate: true,
        called_number: calledNumber,
        sequence: callSequence,
        game_status: game.status,
        winner_id: game.winner_id ?? null,
        next_active_player_id: game.active_player_id,
        newly_completed_lines: [],
        updated_scores: scores,
      },
    }
  }

  // ── Time bank check (spec bingo-disconnect-recovery §3.2) ─────────────────
  // Checked against the server's own turn_started_at, never a client-supplied
  // "my time is up" claim. Applies equally to bot-controlled seats — their
  // bank still ticks down like a real player's (design.md §1.2).
  const { data: myGamePlayer } = await admin
    .from('game_players')
    .select('time_remaining_ms')
    .eq('game_id', gameId)
    .eq('player_id', callerId)
    .single()

  const elapsedMs = Date.now() - new Date(game.turn_started_at).getTime()
  if (myGamePlayer && elapsedMs >= myGamePlayer.time_remaining_ms) {
    const result = await resolvePlayerOut(admin, gameId, game.room_id, callerId, 'TIMEOUT', room.capacity, isRanked)
    return {
      ok: true,
      data: {
        called_number: null,
        sequence: callSequence,
        game_status: result.gameStatus,
        winner_id: result.winnerId,
        winning_call: null,
        next_active_player_id: result.nextActivePlayerId,
        newly_completed_lines: [],
        updated_scores: {},
        timed_out: true,
      },
    }
  }

  // ── Check number not already called ──────────────────────────────────────
  const { data: dupNumber } = await admin
    .from('game_calls')
    .select('id')
    .eq('game_id', gameId)
    .eq('number', calledNumber)
    .maybeSingle()

  if (dupNumber) {
    return { ok: false, code: 'NUMBER_ALREADY_CALLED', message: `Number ${calledNumber} has already been called`, status: 409 }
  }

  // ── Sequence validation ───────────────────────────────────────────────────
  const { count: existingCallCount } = await admin
    .from('game_calls')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', gameId)

  const expectedSequence = (existingCallCount ?? 0) + 1
  if (callSequence !== expectedSequence) {
    return { ok: false, code: 'CONCURRENT_CONFLICT', message: `Expected sequence ${expectedSequence}, got ${callSequence}`, status: 409 }
  }

  // ── Insert game_call ──────────────────────────────────────────────────────
  const { error: callInsertError } = await admin
    .from('game_calls')
    .insert({
      game_id: gameId,
      caller_id: callerId,
      number: calledNumber,
      sequence: callSequence,
    })

  if (callInsertError) {
    if (callInsertError.code === '23505') {
      return { ok: false, code: 'CONCURRENT_CONFLICT', message: 'Concurrent call conflict — retry', status: 409 }
    }
    console.error('[resolveCall] insert call error:', callInsertError)
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to record call', status: 500 }
  }

  // ── Fetch all boards + existing completed lines ───────────────────────────
  const [{ data: gameBoards }, { data: gamePlayers }, { data: existingLines }] =
    await Promise.all([
      admin.from('game_boards').select('player_id, layout').eq('game_id', gameId),
      admin.from('game_players').select('player_id, score, turn_order, is_out').eq('game_id', gameId),
      admin.from('game_completed_lines').select('player_id, line_id').eq('game_id', gameId),
    ])

  // ── Build called set for this game ────────────────────────────────────────
  const { data: allCalls } = await admin
    .from('game_calls')
    .select('number')
    .eq('game_id', gameId)

  const calledSet = new Set<number>((allCalls ?? []).map((c: { number: number }) => c.number))

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
      game_id: gameId,
      player_id: l.player_id,
      line_id: l.line_id,
      completing_call_sequence: callSequence,
    }))
    const { error: lineError } = await admin.from('game_completed_lines').insert(lineRows)
    if (lineError && lineError.code !== '23505') {
      console.error('[resolveCall] insert lines error:', lineError)
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
        .eq('game_id', gameId)
        .eq('player_id', gp.player_id)
    }
  }

  // ── Win check ─────────────────────────────────────────────────────────────
  const winnerExists = Object.values(updatedScores).some((s) => s >= 5)

  if (winnerExists) {
    // Win Path — CRITICAL ordering (spec bingo-game-mechanics §4e):
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
      .eq('id', gameId)

    await admin.from('game_results').insert({
      game_id: gameId,
      winner_id: captured_winner_id,
      outcome: 'WINNER',
      final_scores: updatedScores,
      total_calls: callSequence,
    })

    await admin
      .from('rooms')
      .update({ status: 'GAME_FINISHED' })
      .eq('id', game.room_id)

    if (isRanked) {
      await finalizeRankedStats(admin, Object.keys(updatedScores), captured_winner_id, room.capacity)
    }

    return {
      ok: true,
      data: {
        called_number: calledNumber,
        sequence: callSequence,
        game_status: 'FINISHED',
        winner_id: captured_winner_id,
        winning_call: calledNumber,
        next_active_player_id: null,
        newly_completed_lines: newlyCompletedLines,
        updated_scores: updatedScores,
      },
    }
  }

  //── Draw check (all 25 called, no winner) ─────────────────────────────────
  if (callSequence === 25) {
    await admin
      .from('games')
      .update({
        active_player_id: null,
        status: 'ABANDONED',
        finished_at: new Date().toISOString(),
      })
      .eq('id', gameId)

    await admin.from('game_results').insert({
      game_id: gameId,
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
      await finalizeRankedStats(admin, Object.keys(updatedScores), null, room.capacity)
    }

    return {
      ok: true,
      data: {
        called_number: calledNumber,
        sequence: callSequence,
        game_status: 'ABANDONED',
        winner_id: null,
        next_active_player_id: null,
        newly_completed_lines: newlyCompletedLines,
        updated_scores: updatedScores,
      },
    }
  }

  //── Continue Path — advance turn ──────────────────────────────────────────
  const nextPlayerId = advanceTurn(gamePlayers ?? [], callerId)

  // Deduct the time this turn actually took from the caller's bank, and
  // start the next player's clock fresh — spec bingo-disconnect-recovery §3.2.
  if (myGamePlayer) {
    await admin
      .from('game_players')
      .update({ time_remaining_ms: Math.max(0, myGamePlayer.time_remaining_ms - elapsedMs) })
      .eq('game_id', gameId)
      .eq('player_id', callerId)
  }

  await admin
    .from('games')
    .update({ active_player_id: nextPlayerId, turn_started_at: new Date().toISOString() })
    .eq('id', gameId)

  return {
    ok: true,
    data: {
      called_number: calledNumber,
      sequence: callSequence,
      game_status: 'ACTIVE',
      winner_id: null,
      next_active_player_id: nextPlayerId,
      newly_completed_lines: newlyCompletedLines,
      updated_scores: updatedScores,
    },
  }
}
