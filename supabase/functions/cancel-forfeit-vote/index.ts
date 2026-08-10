/**
 * Edge Function: cancel-forfeit-vote
 *
 * Req 3.4.5: if the disconnected player reconnects at any point before a
 * vote against them concludes, the vote is cancelled immediately — no
 * forfeit, they simply resume play. The reconnecting player's own client
 * calls this the moment it discovers (via the forfeit_votes Realtime
 * subscription) a PENDING vote naming it as the target — the act of that
 * client successfully making an authenticated call is itself the proof of
 * presence, so no extra verification is needed beyond "are you the target."
 *
 * Cancellation reuses the FAILED status rather than adding a new one — a
 * vote that didn't result in a forfeit either way is indistinguishable in
 * outcome, and Phase 6's eventual bot-takeover-on-FAILED logic will need to
 * check current presence before acting regardless, which naturally covers
 * this case too.
 *
 * Request body: { vote_id }
 * Response: { status }
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.4.5
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

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
    .select('id, target_player_id, status')
    .eq('id', voteId)
    .single()

  if (voteError || !vote) {
    return err('VOTE_NOT_FOUND', 'Vote not found', 404)
  }

  if (vote.target_player_id !== userId) {
    return err('FORBIDDEN', 'Only the targeted player can cancel this vote', 403)
  }

  if (vote.status !== 'PENDING') {
    return ok({ status: vote.status })
  }

  await admin
    .from('forfeit_votes')
    .update({ status: 'FAILED', resolved_at: new Date().toISOString() })
    .eq('id', voteId)
    .eq('status', 'PENDING')

  return ok({ status: 'FAILED', cancelledByReconnect: true })
})
