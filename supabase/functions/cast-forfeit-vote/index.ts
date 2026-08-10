/**
 * Edge Function: cast-forfeit-vote
 *
 * Records one ballot on a PENDING forfeit vote. In a 2-player game this is
 * the entire "vote" (spec D3 — the sole other player's accept/deny prompt,
 * Req 3.4.1); in 3-4p (Phase 5 UI) it's one ballot among several.
 *
 * Resolution happens here, not just at expiry:
 *   - Any explicit NO → immediately FAILED (Req 3.4.4).
 *   - Every eligible voter (all active players except the target) has now
 *     voted YES → immediately PASSED, forfeit applied via resolvePlayerOut.
 *   - Otherwise stays PENDING until resolve-expired-vote is called after
 *     expires_at.
 *
 * Request body: { vote_id, choice: 'YES' | 'NO' }
 * Response: { status, game_status?, winner_id?, next_active_player_id? }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.4
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolvePlayerOut } from '../_shared/resolvePlayerOut.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { vote_id?: unknown; choice?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.vote_id !== 'string') {
    return err('INVALID_INPUT', 'vote_id is required', 400)
  }
  if (body.choice !== 'YES' && body.choice !== 'NO') {
    return err('INVALID_INPUT', 'choice must be YES or NO', 400)
  }
  const voteId = body.vote_id
  const choice = body.choice

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: vote, error: voteError } = await admin
    .from('forfeit_votes')
    .select('id, game_id, target_player_id, status, expires_at')
    .eq('id', voteId)
    .single()

  if (voteError || !vote) {
    return err('VOTE_NOT_FOUND', 'Vote not found', 404)
  }

  if (vote.status !== 'PENDING') {
    return ok({ status: vote.status })
  }

  if (new Date(vote.expires_at).getTime() < Date.now()) {
    return err('VOTE_EXPIRED', 'This vote window has closed', 409)
  }

  if (userId === vote.target_player_id) {
    return err('FORBIDDEN', 'You cannot vote on your own forfeit', 403)
  }

  const { data: game } = await admin
    .from('games')
    .select('id, room_id')
    .eq('id', vote.game_id)
    .single()

  if (!game) {
    return err('INTERNAL_ERROR', 'Game not found for this vote', 500)
  }

  const { data: room } = await admin
    .from('rooms')
    .select('capacity, is_ranked')
    .eq('id', game.room_id)
    .single()

  const { data: gamePlayers } = await admin
    .from('game_players')
    .select('player_id, is_out')
    .eq('game_id', vote.game_id)

  const caller = (gamePlayers ?? []).find((p) => p.player_id === userId)
  if (!caller || caller.is_out) {
    return err('FORBIDDEN', 'You are not an eligible voter in this game', 403)
  }

  const { error: ballotError } = await admin
    .from('forfeit_vote_ballots')
    .upsert(
      { vote_id: voteId, voter_player_id: userId, choice },
      { onConflict: 'vote_id,voter_player_id' }
    )

  if (ballotError) {
    console.error('[cast-forfeit-vote] ballot upsert error:', ballotError)
    return err('INTERNAL_ERROR', 'Failed to record vote', 500)
  }

  if (choice === 'NO') {
    await admin
      .from('forfeit_votes')
      .update({ status: 'FAILED', resolved_at: new Date().toISOString() })
      .eq('id', voteId)
      .eq('status', 'PENDING')

    // Req 3.5.1: a failed forfeit vote against a still-disconnected player
    // hands their seat to the bot, rather than leaving the game stuck
    // waiting on someone who isn't there. Safe to set unconditionally here —
    // if the target had actually reconnected, cancel-forfeit-vote would
    // already have flipped this same vote to FAILED first (idempotent
    // .eq('status','PENDING') guard above means this UPDATE is a no-op in
    // that case, so this vote's own NO branch never runs after a cancel).
    await admin
      .from('game_players')
      .update({ bot_controlled: true })
      .eq('game_id', vote.game_id)
      .eq('player_id', vote.target_player_id)

    return ok({ status: 'FAILED' })
  }

  // ── Check for unanimous-YES-among-eligible-voters ───────────────────────
  const eligibleVoterIds = (gamePlayers ?? [])
    .filter((p) => !p.is_out && p.player_id !== vote.target_player_id)
    .map((p) => p.player_id)

  const { data: ballots } = await admin
    .from('forfeit_vote_ballots')
    .select('voter_player_id, choice')
    .eq('vote_id', voteId)

  const yesVoterIds = new Set((ballots ?? []).filter((b) => b.choice === 'YES').map((b) => b.voter_player_id))
  const allEligibleVotedYes = eligibleVoterIds.every((id) => yesVoterIds.has(id))

  if (!allEligibleVotedYes) {
    return ok({ status: 'PENDING' })
  }

  // Guarded by .eq('status', 'PENDING') + .select(): if two concurrent
  // callers both observe unanimous YES at the same instant, only the one
  // whose UPDATE actually flips the row gets a result back — the other
  // sees an empty array and must not call resolvePlayerOut a second time
  // (which would double-insert game_results / double-count ranked stats).
  const { data: passedRows, error: passUpdateError } = await admin
    .from('forfeit_votes')
    .update({ status: 'PASSED', resolved_at: new Date().toISOString() })
    .eq('id', voteId)
    .eq('status', 'PENDING')
    .select('id')

  if (passUpdateError) {
    console.error('[cast-forfeit-vote] pass update error:', passUpdateError)
    return err('INTERNAL_ERROR', 'Failed to resolve vote', 500)
  }

  if (!passedRows || passedRows.length === 0) {
    // Lost the race — someone else's concurrent call already resolved this.
    return ok({ status: 'PASSED' })
  }

  const result = await resolvePlayerOut(
    admin, vote.game_id, game.room_id, vote.target_player_id, 'FORFEIT_VOTE',
    room!.capacity, room!.is_ranked === true
  )

  return ok({
    status: 'PASSED',
    game_status: result.gameStatus,
    winner_id: result.winnerId,
    next_active_player_id: result.nextActivePlayerId,
  })
})
