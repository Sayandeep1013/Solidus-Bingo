/**
 * Edge Function: get-leaderboard
 *
 * Read-only leaderboard query over player_stats (Ranked_Game outcomes only —
 * see finalizeRankedStats in call-number/index.ts, the sole writer).
 *
 * Request body: { capacity: 2 | 3 | 4, sort?: 'wins' | 'win_rate', limit?: number, offset?: number }
 * Response: { entries: [...], total, sort, capacity, my_entry: {...} | null }
 *
 * Spec: bingo-leaderboard §Req 2; bingo-disconnect-recovery §3.1 (mode split —
 * player_stats is keyed by (player_id, capacity), so every query is scoped
 * to one party size. A 4-player win is a different ranking from a 2-player
 * win, never mixed together.)
 * - sort=wins: every player with a player_stats row at this capacity, ordered by games_won desc
 * - sort=win_rate: only players with games_played >= 5 *at this capacity*, ordered by win_rate desc
 * - Tie-break: (wins) win_rate desc, then username asc.
 *              (win_rate) games_won desc, then username asc.
 * - my_entry: the requesting player's own row + rank even if outside the
 *   returned page, so they can see their standing without paging to find it.
 *
 * Given this app's realistic scale (a handful of friends, not a public
 * leaderboard with thousands of rows), this fetches all player_stats rows
 * and sorts/paginates in memory rather than building out SQL-side ordering —
 * simpler and consistent with every other Edge Function's plain
 * admin-client-query style.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, handleCors, ok, err, CORS_HEADERS } from '../_shared/auth.ts'

const WIN_RATE_MIN_GAMES = 5
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

interface LeaderboardEntry {
  player_id: string
  username: string
  games_played: number
  games_won: number
  win_rate: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCors()

  const auth = await requireAuth(req, CORS_HEADERS)
  if (auth.error) return auth.error
  const { userId } = auth

  let body: { capacity?: unknown; sort?: unknown; limit?: unknown; offset?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body — capacity is still required below
  }

  if (![2, 3, 4].includes(body.capacity as number)) {
    return err('INVALID_INPUT', 'capacity must be 2, 3, or 4', 400)
  }
  const capacity = body.capacity as 2 | 3 | 4

  const sort = body.sort === 'win_rate' ? 'win_rate' : 'wins'
  const limit = Number.isInteger(body.limit)
    ? Math.min(Math.max(body.limit as number, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset = Number.isInteger(body.offset) && (body.offset as number) >= 0 ? (body.offset as number) : 0

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: rows, error } = await admin
    .from('player_stats')
    .select('player_id, games_played, games_won, profiles(username)')
    .eq('capacity', capacity)

  if (error) {
    console.error('[get-leaderboard] fetch error:', error)
    return err('INTERNAL_ERROR', 'Failed to load leaderboard', 500)
  }

  let entries: LeaderboardEntry[] = (rows ?? []).map((r) => {
    const profile = r.profiles as unknown as { username: string | null } | null
    return {
      player_id: r.player_id as string,
      username: profile?.username ?? 'Player',
      games_played: r.games_played as number,
      games_won: r.games_won as number,
      win_rate: (r.games_played as number) > 0
        ? Math.round(((r.games_won as number) / (r.games_played as number)) * 1000) / 10
        : 0,
    }
  })

  if (sort === 'win_rate') {
    entries = entries.filter((e) => e.games_played >= WIN_RATE_MIN_GAMES)
    entries.sort((a, b) =>
      b.win_rate - a.win_rate ||
      b.games_won - a.games_won ||
      a.username.localeCompare(b.username)
    )
  } else {
    entries.sort((a, b) =>
      b.games_won - a.games_won ||
      b.win_rate - a.win_rate ||
      a.username.localeCompare(b.username)
    )
  }

  const total = entries.length
  const page = entries.slice(offset, offset + limit).map((e, i) => ({ ...e, rank: offset + i + 1 }))

  const myIndex = entries.findIndex((e) => e.player_id === userId)
  const myEntry = myIndex !== -1 ? { ...entries[myIndex], rank: myIndex + 1 } : null

  return ok({
    entries: page,
    total,
    sort,
    capacity,
    win_rate_min_games: WIN_RATE_MIN_GAMES,
    my_entry: myEntry,
  })
})
