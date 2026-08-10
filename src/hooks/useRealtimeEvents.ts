/**
 * src/hooks/useRealtimeEvents.ts
 *
 * Routes every Realtime event to the correct Zustand store action.
 * Also exposes fetchSnapshot() — called on every reconnect BEFORE
 * processing queued events (spec bingo-realtime §Req 7).
 *
 * Key rules:
 * - No optimistic updates — stores are only mutated here (from confirmed events)
 * - Sequence-gap detection: if game_calls INSERT arrives with sequence > lastCallSequence+1,
 *   fetch snapshot immediately instead of trying to reconstruct
 * - All handlers are idempotent (duplicate events are safe to apply twice)
 *
 * Design note: Store actions are accessed via .getState() inside useCallback
 * so the callbacks are stable (no unnecessary re-subscriptions).
 */
import { useCallback, useRef } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { invokeEdgeFunction } from '../lib/invokeEdgeFunction'
import { applyGameSnapshot } from '../lib/gameSnapshot'
import {
  useRoomStore,
  useGameStore,
  useConnectionStore,
  usePresenceStore,
} from '../store'
import type { PresenceEntry, RoomStatus } from '../types/game'
import type { LineId } from '../lib/gameEngine'

type TableName =
  | 'rooms' | 'room_players' | 'games' | 'game_players'
  | 'game_calls' | 'game_completed_lines' | 'rematch_votes'
  | 'presence_sync' | 'presence_join' | 'presence_leave'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPayload = RealtimePostgresChangesPayload<Record<string, any>> | Record<string, any>

export function useRealtimeEvents(gameId: string | null) {
  // Keep gameId in a ref so the stable callbacks always read the latest value
  const gameIdRef = useRef(gameId)
  gameIdRef.current = gameId

  // ── Snapshot fetch (called on every reconnect, and whenever a 'games' event
  // introduces a game_id the store doesn't have loaded yet — e.g. right after
  // Start Game, or when a rematch creates a new game) ───────────────────────
  const fetchSnapshot = useCallback(async (explicitGameId?: string) => {
    const currentGameId = explicitGameId ?? gameIdRef.current
    if (!currentGameId) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data, error } = await invokeEdgeFunction('get-game-state', {
      body: { game_id: currentGameId },
    })

    if (error || !data?.data) {
      throw new Error(error?.message ?? 'get-game-state returned no data')
    }

    applyGameSnapshot(data.data)
  }, []) // stable — reads from refs and .getState()

  // ── Main event dispatcher ─────────────────────────────────────────────────
  const dispatchEvent = useCallback((table: TableName, payload: AnyPayload) => {
    switch (table) {

      // ── rooms UPDATE ────────────────────────────────────────────────────
      case 'rooms': {
        // Cast the `.new` field directly rather than via
        // RealtimePostgresChangesPayload<T> — that generic types `.new` as
        // `T | {}` (the `{}` covers DELETE events), and `{}` is always
        // truthy, so `if (!record) break` can't narrow it away.
        const record = (payload as { new?: { status: RoomStatus; host_id: string } }).new
        if (!record) break
        useRoomStore.getState().updateRoomStatus(record.status)
        if (record.host_id) useRoomStore.getState().updateHostId(record.host_id)
        break
      }

      // ── room_players INSERT / UPDATE ────────────────────────────────────
      case 'room_players': {
        const record = (payload as {
          new?: { player_id: string; join_order: number; status: string }
        }).new
        if (!record) break
        if (record.status === 'ACTIVE') {
          useRoomStore.getState().upsertPlayer({
            playerId: record.player_id,
            username: null,
            joinOrder: record.join_order,
            isOnline: true,
          })
        } else {
          useRoomStore.getState().updatePlayer(record.player_id, { isOnline: false })
        }
        break
      }

      // ── games INSERT / UPDATE ────────────────────────────────────────────
      case 'games': {
        const record = (payload as {
          new?: {
            id: string; status: string; active_player_id: string | null;
            winner_id: string | null; winning_call: number | null
          }
        }).new
        if (!record) break

        // Bug fix: this used to only patch activePlayerId/status, and nothing
        // ever set gameStore.gameId for a newly-created game. Since the lobby's
        // navigation guard requires gameId to be truthy, players could never
        // be navigated from the lobby into a game that just started (or a
        // rematch). Whenever we see a game_id the store doesn't have loaded,
        // fetch its full snapshot (which does set gameId) instead of patching.
        if (record.id !== useGameStore.getState().gameId) {
          fetchSnapshot(record.id).catch((err) => {
            useConnectionStore.getState().setSnapshotError(
              err instanceof Error ? err.message : 'Snapshot fetch failed'
            )
          })
          break
        }

        useGameStore.getState().updateActivePlayer(record.active_player_id ?? null)
        useGameStore.getState().updateGameStatus(
          record.status as never,
          record.winner_id ?? null,
          record.winning_call ?? null
        )
        break
      }

      // ── game_players UPDATE ─────────────────────────────────────────────
      case 'game_players': {
        const record = (payload as {
          new?: { game_id: string; player_id: string; score: number }
        }).new
        if (!record) break
        // These three tables have no room_id column, so the channel's
        // postgres_changes filter can't scope them server-side — every game
        // in the room's history (and, if the subscription payload weren't
        // otherwise scoped, any concurrently-running game elsewhere) would
        // hit every client's store. Guard client-side against the one game
        // currently loaded.
        if (record.game_id !== useGameStore.getState().gameId) break
        useGameStore.getState().updateScore(record.player_id, record.score)
        break
      }

      // ── game_calls INSERT ───────────────────────────────────────────────
      case 'game_calls': {
        const record = (payload as {
          new?: { game_id: string; number: number; sequence: number; caller_id: string }
        }).new
        if (!record) break
        if (record.game_id !== useGameStore.getState().gameId) break

        const { lastCallSequence } = useGameStore.getState()
        const expectedSequence = lastCallSequence + 1

        if (record.sequence > expectedSequence) {
          // Sequence gap — fetch snapshot immediately
          console.warn(
            `[Realtime] Sequence gap: expected ${expectedSequence}, got ${record.sequence}. Fetching snapshot.`
          )
          fetchSnapshot().catch((err) => {
            useConnectionStore.getState().setSnapshotError(
              err instanceof Error ? err.message : 'Snapshot fetch failed'
            )
          })
          break
        }

        useGameStore.getState().applyCall({
          number: record.number,
          sequence: record.sequence,
          newActivePlayerId: null,  // updated via games UPDATE
          newlyCompletedLines: [],  // updated via game_completed_lines INSERT
          updatedScores: {},        // updated via game_players UPDATE
        })
        break
      }

      // ── game_completed_lines INSERT ─────────────────────────────────────
      case 'game_completed_lines': {
        const record = (payload as {
          new?: { game_id: string; player_id: string; line_id: string; completing_call_sequence: number }
        }).new
        if (!record) break
        if (record.game_id !== useGameStore.getState().gameId) break
        useGameStore.getState().applyCompletedLine({
          playerId: record.player_id,
          lineId: record.line_id as LineId,
          completingCallSequence: record.completing_call_sequence,
        })
        break
      }

      // ── rematch_votes INSERT ────────────────────────────────────────────
      case 'rematch_votes': {
        useRoomStore.getState().incrementRematchVoteCount()
        break
      }

      // ── Presence sync ───────────────────────────────────────────────────
      case 'presence_sync': {
        const { presenceState } = payload as { presenceState: Record<string, unknown[]> }
        const roster: PresenceEntry[] = []
        for (const presences of Object.values(presenceState)) {
          for (const p of presences) {
            const entry = p as { playerId?: string; username?: string; onlineAt?: string }
            if (entry.playerId) {
              roster.push({
                playerId: entry.playerId,
                username: entry.username ?? null,
                onlineAt: entry.onlineAt ?? new Date().toISOString(),
              })
            }
          }
        }
        usePresenceStore.getState().syncPresence(roster)
        const onlineIds = new Set(roster.map((r) => r.playerId))
        for (const player of useRoomStore.getState().players) {
          useRoomStore.getState().updatePlayer(player.playerId, { isOnline: onlineIds.has(player.playerId) })
        }
        break
      }

      case 'presence_join': {
        const { newPresences } = payload as { newPresences: unknown[] }
        for (const p of newPresences) {
          const entry = p as { playerId?: string; username?: string; onlineAt?: string }
          if (entry.playerId) {
            usePresenceStore.getState().playerJoinedPresence({
              playerId: entry.playerId,
              username: entry.username ?? null,
              onlineAt: entry.onlineAt ?? new Date().toISOString(),
            })
            useRoomStore.getState().updatePlayer(entry.playerId, { isOnline: true })
          }
        }
        break
      }

      case 'presence_leave': {
        const { leftPresences } = payload as { leftPresences: unknown[] }
        for (const p of leftPresences) {
          const entry = p as { playerId?: string }
          if (entry.playerId) {
            usePresenceStore.getState().playerLeftPresence(entry.playerId)
            useRoomStore.getState().updatePlayer(entry.playerId, { isOnline: false })
          }
        }
        break
      }
    }
  }, [fetchSnapshot]) // stable — all store access via .getState()

  return { dispatchEvent, fetchSnapshot }
}
