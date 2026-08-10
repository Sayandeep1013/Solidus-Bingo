/**
 * supabase/functions/_shared/finalizeRankedStats.ts
 *
 * Increments player_stats for a finished Ranked_Game. Only ever called when
 * the room's is_ranked flag (re-verified from the DB, never trusted from a
 * cache) is true — spec bingo-leaderboard §Req 1, 4. Normal-room games never
 * reach this function at all, which is what makes the leaderboard
 * structurally immune to normal-room manipulation.
 *
 * player_stats is keyed by (player_id, capacity) — a 4-player win is a
 * separate ranking from a 2-player win, spec
 * bingo-disconnect-recovery/requirements.md §3.1.
 *
 * Uses read-then-write rather than an atomic SQL increment (no RPC
 * functions elsewhere in this codebase to justify introducing one here) —
 * safe in practice because a player can only ever be active in one game at
 * a time (join-queue rejects queueing while IN_GAME), so this player's own
 * row can never be written concurrently by two finishing games.
 *
 * Previously duplicated verbatim in call-number and claim-forfeit-win —
 * factored out here once a third caller (resolvePlayerOut) needed it too.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function finalizeRankedStats(admin: any, playerIds: string[], winnerId: string | null, capacity: number) {
  for (const playerId of playerIds) {
    const { data: existing } = await admin
      .from('player_stats')
      .select('games_played, games_won')
      .eq('player_id', playerId)
      .eq('capacity', capacity)
      .maybeSingle()

    const gamesPlayed = (existing?.games_played ?? 0) + 1
    const gamesWon = (existing?.games_won ?? 0) + (playerId === winnerId ? 1 : 0)

    const { error } = await admin
      .from('player_stats')
      .upsert(
        { player_id: playerId, capacity, games_played: gamesPlayed, games_won: gamesWon },
        { onConflict: 'player_id,capacity' }
      )

    if (error) console.error('[finalizeRankedStats] upsert error:', playerId, error)
  }
}
