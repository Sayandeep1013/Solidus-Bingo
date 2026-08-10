/**
 * Edge Function: get-my-status
 *
 * Checked on Home-screen load so a player is never stuck not knowing they
 * have a game to get back to, or that a game finished while they were
 * gone — spec .kiro/specs/bingo-disconnect-recovery/requirements.md §3.8.
 * Before this existed, the only way to discover either was hitting a
 * confusing ALREADY_IN_GAME error when trying to do something else.
 *
 * Request body: {} (uses the caller's own auth)
 * Response: {
 *   active_game: { room_id, game_id, capacity } | null,
 *   unseen_result: { room_id, game_id, capacity, outcome: 'WON'|'LOST'|'DRAW' } | null
 * }
 *
 * A player's room_players row persists across rematches within the same
 * room, so "have I seen this room's result" is computed by comparing
 * result_seen_at against the most recent finished game's finished_at —
 * not a plain null-check — so a fresh rematch's result correctly counts
 * as unseen again even if an earlier game in the same room was already
 * acknowledged.
 *
 * N+1 query pattern (one games lookup per active room membership) —
 * consistent with this codebase's existing "handful of friends, not a
 * public product at scale" posture (see get-leaderboard's identical
 * reasoning) rather than one clever joined query.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

interface RoomInfo {
  id: string
  status: string
  capacity: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: memberships, error } = await admin
    .from('room_players')
    .select('room_id, result_seen_at, rooms(id, status, capacity)')
    .eq('player_id', userId)
    .eq('status', 'ACTIVE')

  if (error) {
    console.error('[get-my-status] fetch error:', error)
    return err('INTERNAL_ERROR', 'Failed to load status', 500)
  }

  let activeGame: { room_id: string; game_id: string; capacity: number } | null = null
  let activeGameUpdatedAt: string | null = null

  let unseenResult: { room_id: string; game_id: string; capacity: number; outcome: 'WON' | 'LOST' | 'DRAW' } | null = null
  let unseenResultFinishedAt: string | null = null

  for (const m of memberships ?? []) {
    const room = m.rooms as unknown as RoomInfo | null
    if (!room) continue

    if (room.status === 'IN_GAME') {
      const { data: game } = await admin
        .from('games')
        .select('id, updated_at')
        .eq('room_id', room.id)
        .eq('status', 'ACTIVE')
        .order('game_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (game && (!activeGameUpdatedAt || game.updated_at > activeGameUpdatedAt)) {
        activeGame = { room_id: room.id, game_id: game.id, capacity: room.capacity }
        activeGameUpdatedAt = game.updated_at
      }
    }

    if (room.status === 'GAME_FINISHED') {
      const { data: game } = await admin
        .from('games')
        .select('id, winner_id, status, finished_at')
        .eq('room_id', room.id)
        .in('status', ['FINISHED', 'ABANDONED'])
        .order('game_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!game || !game.finished_at) continue

      const seenAt = m.result_seen_at as string | null
      const isUnseen = !seenAt || new Date(seenAt) < new Date(game.finished_at)
      if (!isUnseen) continue

      if (!unseenResultFinishedAt || game.finished_at > unseenResultFinishedAt) {
        unseenResult = {
          room_id: room.id,
          game_id: game.id,
          capacity: room.capacity,
          outcome: game.status === 'ABANDONED' ? 'DRAW' : game.winner_id === userId ? 'WON' : 'LOST',
        }
        unseenResultFinishedAt = game.finished_at
      }
    }
  }

  return ok({ active_game: activeGame, unseen_result: unseenResult })
})
