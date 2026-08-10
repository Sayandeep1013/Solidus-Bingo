/**
 * Edge Function: resolve-expired-vote
 *
 * Called by any present client once a PENDING forfeit vote's expires_at has
 * passed (the same "any client can report a deadline, server re-verifies"
 * pattern as claim-timeout-win). Applies the approved tie-break rule (Open
 * Question 1): non-responders are excluded from the tally rather than
 * counted as NO. Since cast-forfeit-vote already resolves a vote to FAILED
 * the instant any explicit NO is cast, a vote that is still PENDING at
 * expiry by construction has zero NO ballots — so expiry always resolves
 * to PASSED, never FAILED, under this rule.
 *
 * Request body: { vote_id }
 * Response: { status, game_status?, winner_id?, next_active_player_id? }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.4.4
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolvePlayerOut } from '../_shared/resolvePlayerOut.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error

  let body: { vote_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.vote_id !== 'string') {
    return err('INVALID_INPUT', 'vote_id is required', 400)
  }
  const voteId = body.vote_id

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

  if (new Date(vote.expires_at).getTime() > Date.now()) {
    return err('NOT_EXPIRED_YET', 'This vote window has not closed yet', 409)
  }

  const { data: game } = await admin
    .from('games')
    .select('id, room_id, status')
    .eq('id', vote.game_id)
    .single()

  if (!game) {
    return err('INTERNAL_ERROR', 'Game not found for this vote', 500)
  }

  // Guarded update + .select(): if two clients race to resolve the same
  // expired vote, only the winner proceeds to resolvePlayerOut.
  const { data: passedRows, error: passUpdateError } = await admin
    .from('forfeit_votes')
    .update({ status: 'PASSED', resolved_at: new Date().toISOString() })
    .eq('id', voteId)
    .eq('status', 'PENDING')
    .select('id')

  if (passUpdateError) {
    console.error('[resolve-expired-vote] update error:', passUpdateError)
    return err('INTERNAL_ERROR', 'Failed to resolve vote', 500)
  }

  if (!passedRows || passedRows.length === 0) {
    return ok({ status: 'PASSED' })
  }

  if (game.status !== 'ACTIVE') {
    // Game already ended some other way while this vote sat expired —
    // nothing left to resolve against.
    return ok({ status: 'PASSED' })
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
    admin, vote.game_id, game.room_id, vote.target_player_id, 'FORFEIT_VOTE',
    room.capacity, room.is_ranked === true
  )

  return ok({
    status: 'PASSED',
    game_status: result.gameStatus,
    winner_id: result.winnerId,
    next_active_player_id: result.nextActivePlayerId,
  })
})
