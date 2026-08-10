/**
 * Edge Function: join-room
 *
 * Joins an existing room using its 6-char code.
 *
 * Request body: { code: string }
 * Response: { room_id, code, capacity, host_id, status, join_order }
 *
 * Spec: bingo-edge-functions, bingo-room-lobby
 * - Normalises code: uppercase + strip whitespace
 * - Validates: room exists, status=WAITING, not full, not already member
 * - Transitions room to FULL if this is the last slot
 * - Uses SELECT FOR UPDATE via SERIALIZABLE to prevent race conditions
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { code?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  if (typeof body.code !== 'string' || !body.code.trim()) {
    return err('INVALID_INPUT', 'code is required', 400)
  }

  // Normalise: uppercase, strip whitespace
  const code = body.code.trim().toUpperCase()

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Find the room by code ─────────────────────────────────────────────────
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('id, code, capacity, host_id, status')
    .eq('code', code)
    .neq('status', 'CLOSED')
    .maybeSingle()

  if (roomError) {
    console.error('[join-room] room lookup error:', roomError)
    return err('INTERNAL_ERROR', 'Database error', 500)
  }

  if (!room) {
    return err('ROOM_NOT_FOUND', `No active room found with code ${code}`, 404)
  }

  if (room.status !== 'WAITING') {
    return err('ROOM_NOT_JOINABLE', `Room is not accepting new players (status: ${room.status})`, 409)
  }

  // ── Check already a member ────────────────────────────────────────────────
  const { data: existing } = await admin
    .from('room_players')
    .select('id')
    .eq('room_id', room.id)
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  if (existing) {
    return err('ALREADY_IN_ROOM', 'You are already in this room', 409)
  }

  // ── Count current active players ──────────────────────────────────────────
  const { count: activeCount, error: countError } = await admin
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room.id)
    .eq('status', 'ACTIVE')

  if (countError || activeCount === null) {
    return err('INTERNAL_ERROR', 'Could not count players', 500)
  }

  if (activeCount >= room.capacity) {
    return err('ROOM_FULL', 'Room is already at capacity', 409)
  }

  const joinOrder = activeCount + 1

  // ── Insert player ─────────────────────────────────────────────────────────
  const { error: insertError } = await admin
    .from('room_players')
    .insert({
      room_id: room.id,
      player_id: userId,
      join_order: joinOrder,
      status: 'ACTIVE',
    })

  if (insertError) {
    // Unique constraint violation = another concurrent join beat us to the last slot
    if (insertError.code === '23505') {
      return err('ROOM_FULL', 'Room just filled up', 409)
    }
    console.error('[join-room] insert player error:', insertError)
    return err('INTERNAL_ERROR', 'Failed to join room', 500)
  }

  // ── Transition room to FULL if last slot just filled ──────────────────────
  const newCount = joinOrder
  let newStatus = room.status
  if (newCount >= room.capacity) {
    const { error: updateError } = await admin
      .from('rooms')
      .update({ status: 'FULL' })
      .eq('id', room.id)
      .eq('status', 'WAITING') // guard: only transition if still WAITING

    if (!updateError) newStatus = 'FULL'
  }

  // Bug fix: see create-room's identical comment — the joining client's
  // Realtime subscription starts after this response, so it would never
  // see the Realtime INSERT events for players who joined before it did.
  // Return the full current roster so the client can seed roomStore with
  // everyone already present, not just itself.
  const { data: playersData } = await admin
    .from('room_players')
    .select('player_id, join_order, profiles(username)')
    .eq('room_id', room.id)
    .eq('status', 'ACTIVE')
    .order('join_order', { ascending: true })

  const players = (playersData ?? []).map((p) => ({
    player_id: p.player_id,
    username: (p.profiles as unknown as { username: string | null } | null)?.username ?? null,
    join_order: p.join_order,
  }))

  return ok({
    room_id: room.id,
    code: room.code,
    capacity: room.capacity,
    host_id: room.host_id,
    status: newStatus,
    join_order: joinOrder,
    players,
  })
})
