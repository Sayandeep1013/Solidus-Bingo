/**
 * Edge Function: call-number
 *
 * The active player calls a number. Validates the request, then delegates
 * scoring/line-detection/win-check to the shared resolveCall (also used by
 * submit-bot-move for bot-controlled seats — design.md §3).
 *
 * Request body: { game_id, number, sequence }
 * Response: { game_status, next_active_player_id?, winner_id?, winning_call?,
 *             newly_completed_lines, updated_scores, called_number }
 *
 * Spec: bingo-edge-functions §4e, bingo-game-mechanics §Req 3–5, 7
 *
 * Idempotency:
 *   Same (game_id + number + sequence + caller) → return original result, no re-apply
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'
import { resolveCall } from '../_shared/resolveCall.ts'

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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const result = await resolveCall(admin, game_id, userId, num as number, sequence as number)

  if (!result.ok) {
    return err(result.code, result.message, result.status)
  }
  return ok(result.data)
})
