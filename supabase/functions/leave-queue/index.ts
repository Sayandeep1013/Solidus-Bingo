/**
 * Edge Function: leave-queue
 *
 * Cancels the caller's own WAITING matchmaking queue entry.
 *
 * Request body: {}
 * Response: { cancelled: boolean }
 *
 * Spec: bingo-ranked-matchmaking §Req 4
 * - If the entry already flipped to MATCHED by the time this runs (raced
 *   against a match forming), the DELETE's `.eq('status', 'WAITING')` filter
 *   simply affects zero rows — cancelled: false. The client is expected to
 *   re-check its queue row (already subscribed via Realtime) and follow the
 *   match into the game like any other matched player, per spec Req 4.3.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: deleted, error } = await admin
    .from('matchmaking_queue')
    .delete()
    .eq('player_id', userId)
    .eq('status', 'WAITING')
    .select('id')

  if (error) {
    console.error('[leave-queue] delete error:', error)
    return err('INTERNAL_ERROR', 'Failed to leave queue', 500)
  }

  return ok({ cancelled: (deleted?.length ?? 0) > 0 })
})
