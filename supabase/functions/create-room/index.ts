/**
 * Edge Function: create-room
 *
 * Creates a new game room and adds the creator as the first player (host).
 *
 * Request body: { capacity: 2 | 3 | 4 }
 * Response: { room_id, code, capacity, host_id, status }
 *
 * Spec: bingo-edge-functions, bingo-room-lobby
 * - Validates capacity ∈ {2, 3, 4}
 * - Generates 6-char room code from charset A-HJ-NP-TV-Z2-9 (31 chars)
 * - Retries code generation on collision (extremely rare)
 * - INSERTs rooms + room_players in a single operation (service role bypasses RLS)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

/** Room code charset: A-Z excluding O, I, U; digits 2-9 (excludes 0, 1) */
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789' // 31 chars
const CODE_LENGTH = 6
const MAX_CODE_RETRIES = 10

/** 3 / 5 / 10 / 15 / 30 minutes per player — spec bingo-disconnect-recovery §3.2 */
const VALID_TIME_BANKS_MS = [180_000, 300_000, 600_000, 900_000, 1_800_000]
const DEFAULT_TIME_BANK_MS = 300_000

function generateRoomCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)]
  ).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error

  const { userId } = auth

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { capacity?: unknown; time_bank_ms?: unknown }
  try {
    body = await req.json()
  } catch {
    return err('INVALID_INPUT', 'Request body must be valid JSON', 400)
  }

  const capacity = body.capacity
  if (capacity !== 2 && capacity !== 3 && capacity !== 4) {
    return err('INVALID_CAPACITY', 'capacity must be 2, 3, or 4', 400)
  }

  // Optional — defaults to 5 min/player so existing callers (and any future
  // ones that don't care) don't have to specify it.
  const timeBankMs = body.time_bank_ms === undefined ? DEFAULT_TIME_BANK_MS : body.time_bank_ms
  if (!VALID_TIME_BANKS_MS.includes(timeBankMs as number)) {
    return err('INVALID_TIME_BANK', `time_bank_ms must be one of: ${VALID_TIME_BANKS_MS.join(', ')}`, 400)
  }

  // ── Service role client ───────────────────────────────────────────────────
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Reject if already active in another game ──────────────────────────────
  // join-queue has always had this check; create-room and join-room didn't,
  // which meant a player stuck ACTIVE in one IN_GAME room could create (or
  // join) a second one, compounding the "stuck game" problem instead of
  // avoiding it — spec bingo-disconnect-recovery §3.9.
  const { data: activeMemberships } = await admin
    .from('room_players')
    .select('rooms(status)')
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')

  const alreadyInGame = (activeMemberships ?? []).some(
    (m) => (m.rooms as unknown as { status: string } | null)?.status === 'IN_GAME'
  )
  if (alreadyInGame) {
    return err('ALREADY_IN_GAME', 'You are already in an active game', 409)
  }

  // ── Generate unique room code with retry ──────────────────────────────────
  let code: string | null = null
  for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
    const candidate = generateRoomCode()
    // Check if code is already in use by an active (non-CLOSED) room
    const { data: existing } = await admin
      .from('rooms')
      .select('id')
      .eq('code', candidate)
      .neq('status', 'CLOSED')
      .maybeSingle()

    if (!existing) {
      code = candidate
      break
    }
  }

  if (!code) {
    return err('CODE_GENERATION_FAILED', 'Could not generate a unique room code after retries', 500)
  }

  // ── Insert room ────────────────────────────────────────────────────────────
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .insert({
      code,
      host_id: userId,
      capacity,
      status: 'WAITING',
      time_bank_ms: timeBankMs,
    })
    .select('id, code, capacity, host_id, status, time_bank_ms')
    .single()

  if (roomError || !room) {
    console.error('[create-room] insert room error:', roomError)
    return err('INTERNAL_ERROR', 'Failed to create room', 500)
  }

  // ── Insert host as first room_player ──────────────────────────────────────
  const { error: playerError } = await admin
    .from('room_players')
    .insert({
      room_id: room.id,
      player_id: userId,
      join_order: 1,
      status: 'ACTIVE',
    })

  if (playerError) {
    console.error('[create-room] insert room_player error:', playerError)
    // Roll back the room insert to avoid orphaned room
    await admin.from('rooms').delete().eq('id', room.id)
    return err('INTERNAL_ERROR', 'Failed to add host to room', 500)
  }

  // Bug fix: the client's Realtime subscription only starts AFTER it
  // receives this response and sets roomStore.roomId — it can never
  // receive a Realtime event for a row that was already inserted before
  // that (Realtime only pushes changes that happen after subscription).
  // Without returning the initial roster here, the host's own lobby slot
  // (and, for join-room, every already-present player's slot) would show
  // "Waiting..." forever. Return the current roster so the client can
  // seed roomStore directly instead of relying solely on future events.
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
    status: room.status,
    time_bank_ms: room.time_bank_ms,
    players,
  })
})
