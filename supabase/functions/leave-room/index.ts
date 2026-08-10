/**
 * Edge Function: leave-room
 *
 * Removes the calling player from a room.
 *
 * Request body: { room_id: string }
 * Response: { room_id, new_status, new_host_id }
 *
 * Spec: bingo-edge-functions, bingo-room-lobby
 * - Rejects if room status is IN_GAME → INVALID_STATE_TRANSITION
 * - Marks room_players row as LEFT
 * - If host leaves + others remain → transfer host to lowest join_order
 * - If last player leaves → CLOSED
 * - REMATCH_WAITING: if < 2 remain → CLOSED; if ≥ 2 remain → remove vote + stay REMATCH_WAITING
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { room_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.room_id !== 'string') {
    return err('INVALID_INPUT', 'room_id is required', 400)
  }

  const roomId = body.room_id
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Fetch room ────────────────────────────────────────────────────────────
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('id, status, host_id, capacity')
    .eq('id', roomId)
    .single()

  if (roomError || !room) {
    return err('ROOM_NOT_FOUND', 'Room not found', 404)
  }

  if (room.status === 'CLOSED') {
    return err('ROOM_CLOSED', 'Room is already closed', 409)
  }

  // Cannot leave mid-game
  if (room.status === 'IN_GAME') {
    return err('INVALID_STATE_TRANSITION', 'Cannot leave a room while a game is in progress', 409)
  }

  // ── Verify caller is an active member ─────────────────────────────────────
  const { data: membership } = await admin
    .from('room_players')
    .select('id, join_order')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  if (!membership) {
    return err('UNAUTHORIZED', 'You are not an active member of this room', 403)
  }

  // ── Mark player as LEFT ────────────────────────────────────────────────────
  const { error: leaveError } = await admin
    .from('room_players')
    .update({ status: 'LEFT', left_at: new Date().toISOString() })
    .eq('id', membership.id)

  if (leaveError) {
    console.error('[leave-room] leave error:', leaveError)
    return err('INTERNAL_ERROR', 'Failed to leave room', 500)
  }

  // ── Get remaining active players ──────────────────────────────────────────
  const { data: remaining, error: remainError } = await admin
    .from('room_players')
    .select('player_id, join_order')
    .eq('room_id', roomId)
    .eq('status', 'ACTIVE')
    .order('join_order', { ascending: true })

  if (remainError) {
    console.error('[leave-room] remaining error:', remainError)
    return err('INTERNAL_ERROR', 'Failed to fetch remaining players', 500)
  }

  const remainingPlayers = remaining ?? []

  // ── If REMATCH_WAITING: remove the player's vote ──────────────────────────
  if (room.status === 'REMATCH_WAITING') {
    await admin
      .from('rematch_votes')
      .delete()
      .eq('room_id', roomId)
      .eq('player_id', userId)
    // If fewer than 2 players remain, fall through to CLOSED logic below
  }

  // ── Close room if no players left ─────────────────────────────────────────
  if (remainingPlayers.length === 0) {
    await admin
      .from('rooms')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', roomId)

    return ok({ room_id: roomId, new_status: 'CLOSED', new_host_id: null })
  }

  // ── Close room if REMATCH_WAITING and fewer than 2 remain ─────────────────
  if (room.status === 'REMATCH_WAITING' && remainingPlayers.length < 2) {
    await admin
      .from('rooms')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', roomId)

    return ok({ room_id: roomId, new_status: 'CLOSED', new_host_id: null })
  }

  // ── Transfer host if needed ────────────────────────────────────────────────
  let newHostId = room.host_id
  if (room.host_id === userId) {
    // New host = lowest join_order among remaining
    newHostId = remainingPlayers[0].player_id

    await admin
      .from('rooms')
      .update({ host_id: newHostId })
      .eq('id', roomId)
  }

  // ── Transition room status back to WAITING if it was FULL ─────────────────
  let newStatus = room.status
  if (room.status === 'FULL') {
    newStatus = 'WAITING'
    await admin
      .from('rooms')
      .update({ status: 'WAITING' })
      .eq('id', roomId)
  }

  return ok({ room_id: roomId, new_status: newStatus, new_host_id: newHostId })
})
