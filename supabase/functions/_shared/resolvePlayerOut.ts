/**
 * supabase/functions/_shared/resolvePlayerOut.ts
 *
 * One shared "take a player out of an active game's turn rotation" path —
 * used by forfeit-self, claim-timeout-win, and resolve-expired-vote alike,
 * regardless of *why* the player is leaving (their own choice, running out
 * of time, or a passed forfeit vote). Same resolution either way:
 *
 *   - 2-player room: the sole remaining player is the only possible
 *     beneficiary, so this is a real win/loss, including ranked stats —
 *     the exiting player takes a genuine loss.
 *   - 3-4 player room, at least one player remains: the game continues;
 *     turn rotation simply skips the exited player from now on. If this
 *     leaves exactly one non-out player, no special-case win is needed —
 *     they just get every turn and resolve the game normally by reaching
 *     5 lines through the existing win-check logic in call-number.
 *   - 3-4 player room, nobody remains (edge case — shouldn't normally
 *     happen, guards against it anyway): no-fault ABANDONED, same as the
 *     existing all-25-called draw path.
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/design.md §3
 */
import { finalizeRankedStats } from './finalizeRankedStats.ts'

export type OutReason = 'TIMEOUT' | 'FORFEIT_VOTE' | 'SELF_FORFEIT'

interface GamePlayerRow {
  player_id: string
  score: number
  turn_order: number
  is_out: boolean
}

export interface ResolvePlayerOutResult {
  gameStatus: 'ACTIVE' | 'FINISHED' | 'ABANDONED'
  winnerId: string | null
  nextActivePlayerId: string | null
}

export async function resolvePlayerOut(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  gameId: string,
  roomId: string,
  outPlayerId: string,
  reason: OutReason,
  capacity: number,
  isRanked: boolean
): Promise<ResolvePlayerOutResult> {
  await admin
    .from('game_players')
    .update({ is_out: true, out_reason: reason })
    .eq('game_id', gameId)
    .eq('player_id', outPlayerId)

  const { data: gamePlayersData } = await admin
    .from('game_players')
    .select('player_id, score, turn_order, is_out')
    .eq('game_id', gameId)

  const players = (gamePlayersData ?? []) as GamePlayerRow[]
  const scores: Record<string, number> = {}
  for (const p of players) scores[p.player_id] = p.score

  const remaining = players.filter((p) => !p.is_out)

  if (capacity === 2) {
    const winner = remaining[0]?.player_id ?? null

    await admin
      .from('games')
      .update({
        active_player_id: null,
        winner_id: winner,
        status: 'FINISHED',
        finished_at: new Date().toISOString(),
      })
      .eq('id', gameId)
      .eq('status', 'ACTIVE')

    const { count: totalCalls } = await admin
      .from('game_calls')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', gameId)

    await admin.from('game_results').insert({
      game_id: gameId,
      winner_id: winner,
      outcome: 'WINNER',
      final_scores: scores,
      total_calls: totalCalls ?? 0,
    })
    await admin.from('rooms').update({ status: 'GAME_FINISHED' }).eq('id', roomId)

    if (isRanked && winner) {
      await finalizeRankedStats(admin, Object.keys(scores), winner, capacity)
    }

    return { gameStatus: 'FINISHED', winnerId: winner, nextActivePlayerId: null }
  }

  // ── 3-4 player ────────────────────────────────────────────────────────────
  if (remaining.length === 0) {
    await admin
      .from('games')
      .update({ active_player_id: null, status: 'ABANDONED', finished_at: new Date().toISOString() })
      .eq('id', gameId)
      .eq('status', 'ACTIVE')

    const { count: totalCalls } = await admin
      .from('game_calls')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', gameId)

    await admin.from('game_results').insert({
      game_id: gameId,
      winner_id: null,
      outcome: 'ABANDONED',
      final_scores: scores,
      total_calls: totalCalls ?? 0,
    })
    await admin.from('rooms').update({ status: 'GAME_FINISHED' }).eq('id', roomId)

    if (isRanked) {
      await finalizeRankedStats(admin, Object.keys(scores), null, capacity)
    }

    return { gameStatus: 'ABANDONED', winnerId: null, nextActivePlayerId: null }
  }

  // Game continues — only advance the turn if the player who just left was
  // the one currently active; otherwise whoever's turn it is is unaffected.
  const { data: game } = await admin
    .from('games')
    .select('active_player_id')
    .eq('id', gameId)
    .single()

  let nextActive: string | null = game?.active_player_id ?? null

  if (nextActive === outPlayerId) {
    const allSorted = [...players].sort((a, b) => a.turn_order - b.turn_order)
    const outIdx = allSorted.findIndex((p) => p.player_id === outPlayerId)

    nextActive = null
    for (let step = 1; step <= allSorted.length; step++) {
      const candidate = allSorted[(outIdx + step) % allSorted.length]
      if (!candidate.is_out) {
        nextActive = candidate.player_id
        break
      }
    }

    // Reset the chess clock for whoever inherits the turn — otherwise their
    // elapsed-time check in call-number/claim-timeout-win would be computed
    // from the outgoing player's stale turn_started_at and could make them
    // appear to have already timed out.
    await admin
      .from('games')
      .update({ active_player_id: nextActive, turn_started_at: new Date().toISOString() })
      .eq('id', gameId)
  }

  return { gameStatus: 'ACTIVE', winnerId: null, nextActivePlayerId: nextActive }
}
