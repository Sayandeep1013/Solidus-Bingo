/**
 * Edge Function: initiate-disconnect-resolution
 *
 * Called by a present client roughly 30s after its own Presence subscription
 * observed another player drop from the room's Realtime channel (spec
 * bingo-disconnect-recovery §3.3). Presence is client-ephemeral — there is
 * no server-side ground truth for "are they actually gone" (finding F6) —
 * so unlike the time-bank deadline check, this endpoint trusts the caller's
 * report rather than independently re-deriving it. The blast radius of a
 * false report is bounded: only another active, non-out player in the same
 * game can call this, and Req 3.4.5 lets the reported player immediately
 * cancel any resulting vote just by being observed present again.
 *
 * Request body: { game_id, disconnected_player_id }
 * Response:
 *   - { mode: 'AUTO_FORFEIT', game_status, winner_id, next_active_player_id }
 *     when the room's time bank is <= 10 min/player (no vote — matches
 *     chess.com's behavior for short time controls, design.md §5).
 *   - { mode: 'VOTE_STARTED', vote_id, target_player_id, expires_at }
 *     when the time bank is > 10 min/player. Idempotent: a second caller
 *     hitting this for the same still-pending disconnect gets the same
 *     vote back rather than a duplicate row (unique partial index on
 *     forfeit_votes).
 *   - { mode: 'ALREADY_RESOLVED' } if the target already left rotation.
 *   - { mode: 'ALREADY_BOT_CONTROLLED' } if a prior failed vote already
 *     handed their seat to the bot (§3.5) — no new vote starts.
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.3-3.4,
 * design.md §5
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolvePlayerOut } from '../_shared/resolvePlayerOut.ts'

const LONG_TIME_BANK_THRESHOLD_MS = 600_000 // 10 min
const VOTE_WINDOW_MS = 20_000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { game_id?: unknown; disconnected_player_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.game_id !== 'string' || typeof body.disconnected_player_id !== 'string') {
    return err('INVALID_INPUT', 'game_id and disconnected_player_id are required', 400)
  }
  const gameId = body.game_id
  const targetPlayerId = body.disconnected_player_id

  if (targetPlayerId === userId) {
    return err('INVALID_INPUT', 'Cannot report yourself as disconnected', 400)
  }

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

  const { data: room } = await admin
    .from('rooms')
    .select('capacity, time_bank_ms, is_ranked')
    .eq('id', game.room_id)
    .single()

  if (!room) {
    return err('INTERNAL_ERROR', 'Room not found for this game', 500)
  }

  const { data: gamePlayers } = await admin
    .from('game_players')
    .select('player_id, is_out, bot_controlled')
    .eq('game_id', gameId)

  const caller = (gamePlayers ?? []).find((p) => p.player_id === userId)
  if (!caller || caller.is_out) {
    return err('FORBIDDEN', 'You are not an active player in this game', 403)
  }

  const target = (gamePlayers ?? []).find((p) => p.player_id === targetPlayerId)
  if (!target) {
    return err('INVALID_INPUT', 'That player is not in this game', 400)
  }

  if (target.is_out) {
    return ok({ mode: 'ALREADY_RESOLVED' })
  }

  // Server-side backstop for the same reason the client skips these too
  // (spec §3.5): a bot-controlled seat that's still absent should keep
  // being played by the bot until a real reconnect, not get funneled into
  // *another* forfeit vote — one with no human left to vote NO — that
  // would just forfeit them out a few seconds later and defeat the point
  // of bot takeover. Guards against any stale client still trying.
  if (target.bot_controlled) {
    return ok({ mode: 'ALREADY_BOT_CONTROLLED' })
  }

  // ── Short time bank: plain auto-forfeit, no vote ────────────────────────
  if (room.time_bank_ms <= LONG_TIME_BANK_THRESHOLD_MS) {
    const result = await resolvePlayerOut(
      admin, gameId, game.room_id, targetPlayerId, 'TIMEOUT', room.capacity, room.is_ranked === true
    )
    return ok({
      mode: 'AUTO_FORFEIT',
      game_status: result.gameStatus,
      winner_id: result.winnerId,
      next_active_player_id: result.nextActivePlayerId,
    })
  }

  // ── Long time bank: start (or return the existing) forfeit vote ────────
  const { data: existingVote } = await admin
    .from('forfeit_votes')
    .select('id, expires_at')
    .eq('game_id', gameId)
    .eq('target_player_id', targetPlayerId)
    .eq('status', 'PENDING')
    .maybeSingle()

  if (existingVote) {
    return ok({
      mode: 'VOTE_STARTED',
      vote_id: existingVote.id,
      target_player_id: targetPlayerId,
      expires_at: existingVote.expires_at,
    })
  }

  const expiresAt = new Date(Date.now() + VOTE_WINDOW_MS).toISOString()
  const { data: vote, error: voteError } = await admin
    .from('forfeit_votes')
    .insert({ game_id: gameId, target_player_id: targetPlayerId, status: 'PENDING', expires_at: expiresAt })
    .select('id, expires_at')
    .single()

  if (voteError || !vote) {
    // Unique constraint race — another caller just created it; fetch and return that one.
    if (voteError?.code === '23505') {
      const { data: raced } = await admin
        .from('forfeit_votes')
        .select('id, expires_at')
        .eq('game_id', gameId)
        .eq('target_player_id', targetPlayerId)
        .eq('status', 'PENDING')
        .maybeSingle()
      if (raced) {
        return ok({ mode: 'VOTE_STARTED', vote_id: raced.id, target_player_id: targetPlayerId, expires_at: raced.expires_at })
      }
    }
    console.error('[initiate-disconnect-resolution] vote insert error:', voteError)
    return err('INTERNAL_ERROR', 'Failed to start forfeit vote', 500)
  }

  return ok({
    mode: 'VOTE_STARTED',
    vote_id: vote.id,
    target_player_id: targetPlayerId,
    expires_at: vote.expires_at,
  })
})
