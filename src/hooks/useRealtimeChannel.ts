/**
 * src/hooks/useRealtimeChannel.ts
 *
 * Creates and manages a single Supabase Realtime channel per room.
 * One channel carries ALL subscriptions for that room:
 *   - 7 Postgres Changes tables (rooms, room_players, games, game_players,
 *     game_calls, game_completed_lines, rematch_votes)
 *   - Presence
 *
 * Reconnection strategy (spec bingo-realtime §Req reconnection):
 *   CHANNEL_ERROR / TIMED_OUT → RECONNECTING
 *   Exponential backoff: 1s, 2s, 4s, 8s … max 30s
 *   On reconnect: call fetchSnapshot() FIRST, then resume events
 *   After 120s total without reconnect → DISCONNECTED state
 *
 * AppState (background → foreground) is used to detect silent mobile drops.
 * No optimistic updates — store is only mutated from confirmed events.
 *
 * Design note: All timer callbacks use ref-stored functions to avoid
 * stale closures from useCallback dependency chains.
 */
import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { useConnectionStore } from '../store/connectionStore'
import { useRealtimeEvents } from './useRealtimeEvents'

const MAX_BACKOFF_MS = 30_000
const DISCONNECTED_TIMEOUT_MS = 120_000

export function useRealtimeChannel(roomId: string | null, gameId: string | null) {
  // ── Refs (stable across renders, safe in timer callbacks) ─────────────────
  const channelRef = useRef<RealtimeChannel | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const isSubscribedRef = useRef(false)

  // Store the latest roomId and event handlers in refs so timer callbacks
  // always use the current values without needing to be recreated
  const roomIdRef = useRef(roomId)
  const gameIdRef = useRef(gameId)
  roomIdRef.current = roomId
  gameIdRef.current = gameId

  // ── Hooks (called at top level — Rules of Hooks) ──────────────────────────
  const { dispatchEvent, fetchSnapshot } = useRealtimeEvents(gameId)
  const dispatchRef = useRef(dispatchEvent)
  const fetchRef = useRef(fetchSnapshot)
  dispatchRef.current = dispatchEvent
  fetchRef.current = fetchSnapshot

  // ── Timer helpers ─────────────────────────────────────────────────────────
  function clearTimers() {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null }
  }

  // ── Subscribe function (stable — reads from refs, no useCallback needed) ──
  function subscribeToChannel() {
    const currentRoomId = roomIdRef.current
    if (!currentRoomId) return

    // Remove any existing channel first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    const channel = supabase
      .channel(`room:${currentRoomId}`)

      // Postgres Changes — scoped filters where possible
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoomId}` },
        (payload) => dispatchRef.current('rooms', payload))

      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${currentRoomId}` },
        (payload) => dispatchRef.current('room_players', payload))

      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `room_id=eq.${currentRoomId}` },
        (payload) => dispatchRef.current('games', payload))

      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'game_players' },
        (payload) => dispatchRef.current('game_players', payload))

      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_calls' },
        (payload) => dispatchRef.current('game_calls', payload))

      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_completed_lines' },
        (payload) => dispatchRef.current('game_completed_lines', payload))

      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rematch_votes', filter: `room_id=eq.${currentRoomId}` },
        (payload) => dispatchRef.current('rematch_votes', payload))

      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'forfeit_votes' },
        (payload) => dispatchRef.current('forfeit_votes', payload))

      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'forfeit_vote_ballots' },
        (payload) => dispatchRef.current('forfeit_vote_ballots', payload))

      // Presence
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        dispatchRef.current('presence_sync', { presenceState: state })
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        dispatchRef.current('presence_join', { key, newPresences })
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        dispatchRef.current('presence_leave', { key, leftPresences })
      })

      // Channel status handler
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimers()
          isSubscribedRef.current = true
          reconnectAttemptsRef.current = 0

          // Track presence
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            await channel.track({ playerId: user.id, onlineAt: new Date().toISOString() })
          }

          // Fetch full snapshot BEFORE processing any queued events (spec bingo-realtime)
          try {
            await fetchRef.current()
            useConnectionStore.getState().setConnected()
            useConnectionStore.getState().setSnapshotError(null)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            useConnectionStore.getState().setSnapshotError(msg)
            useConnectionStore.getState().setConnected() // connected even if snapshot failed
          }

        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          isSubscribedRef.current = false
          scheduleReconnect()
        } else if (status === 'CLOSED') {
          isSubscribedRef.current = false
        }
      })

    channelRef.current = channel
  }

  // ── Reconnect with exponential backoff ────────────────────────────────────
  function scheduleReconnect() {
    clearTimers()
    useConnectionStore.getState().setReconnecting()
    useConnectionStore.getState().incrementReconnectAttempts()

    // 120s hard-disconnect timer — if we never reconnect
    disconnectTimerRef.current = setTimeout(() => {
      useConnectionStore.getState().setDisconnected()
    }, DISCONNECTED_TIMEOUT_MS)

    // Exponential backoff timer
    const attempt = reconnectAttemptsRef.current
    const delayMs = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS)
    reconnectAttemptsRef.current += 1

    reconnectTimerRef.current = setTimeout(() => {
      subscribeToChannel()
    }, delayMs)
  }

  // ── AppState: detect silent background disconnects ───────────────────────
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && !isSubscribedRef.current) {
        scheduleReconnect()
      }
    }
    const sub = AppState.addEventListener('change', handleAppStateChange)
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mount / roomId change ─────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return

    reconnectAttemptsRef.current = 0
    subscribeToChannel()

    return () => {
      clearTimers()
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      isSubscribedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  return { isSubscribed: isSubscribedRef.current }
}
