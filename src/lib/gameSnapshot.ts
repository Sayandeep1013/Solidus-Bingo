/**
 * src/lib/gameSnapshot.ts
 *
 * Applies a get-game-state Edge Function response to gameStore. Shared by:
 *   - useRealtimeEvents.fetchSnapshot() — reconnect / sequence-gap path
 *   - the ranked matchmaking screen — which enters a game that was already
 *     fully created server-side by join-queue *before* the client ever
 *     subscribes to Realtime, so there is no 'games' INSERT event to react
 *     to (Realtime only pushes changes that happen after subscription) and
 *     the initial state has to be fetched directly instead.
 */
import { useGameStore } from '../store/gameStore'
import type { CompletedLine } from '../types/game'
import type { LineId } from './gameEngine'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyGameSnapshot(snapshot: any): void {
  const completedLines: CompletedLine[] = []
  for (const [playerId, lines] of Object.entries(snapshot.completed_lines ?? {})) {
    for (const lineId of lines as string[]) {
      completedLines.push({ playerId, lineId: lineId as LineId, completingCallSequence: 0 })
    }
  }

  useGameStore.getState().setGameActive({
    gameId: snapshot.game_id,
    gameNumber: snapshot.game_number ?? null,
    myBoard: snapshot.my_board ?? null,
    activePlayerId: snapshot.active_player_id,
    initialScores: snapshot.scores ?? {},
    initialCalledNumbers: (snapshot.calls ?? []).map((c: { number: number }) => c.number),
    initialCompletedLines: completedLines,
    lastCallSequence: snapshot.calls?.length ?? 0,
    turnStartedAt: snapshot.turn_started_at ?? null,
    initialTimeRemainingMs: snapshot.time_remaining_ms ?? {},
    initialOutPlayerIds: snapshot.out_players ?? {},
    initialBotControlledPlayerIds: snapshot.bot_controlled ?? {},
  })

  if (snapshot.status === 'FINISHED' || snapshot.status === 'ABANDONED') {
    useGameStore.getState().updateGameStatus(
      snapshot.status,
      snapshot.winner_id ?? null,
      snapshot.winning_call ?? null
    )

    // games.winner_id alone cannot express a shared victory — it is NULL for
    // one. The co-winner list lives on the game_results row, which the snapshot
    // carries, so a DRAW is only legible once this has been applied.
    if (snapshot.result) {
      useGameStore.getState().setGameResult({
        outcome: snapshot.result.outcome,
        coWinnerIds: snapshot.result.co_winner_ids ?? [],
      })
    }
  }
}
