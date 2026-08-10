/**
 * src/store/connectionStore.ts — Connection_Store (Zustand)
 *
 * Tracks Realtime channel health.
 *
 * State transitions (spec bingo-realtime §Req reconnection):
 *   CONNECTED → RECONNECTING  (on CHANNEL_ERROR, TIMED_OUT, or AppState background)
 *   RECONNECTING → CONNECTED  (on SUBSCRIBED after reconnect)
 *   RECONNECTING → DISCONNECTED (after 120s with no successful reconnect)
 *
 * Reset: on logout or leave-room.
 */
import { create } from 'zustand'
import type { ConnectionState } from '../types/game'

interface ConnectionStoreState {
  connectionState: ConnectionState
  lastTransitionAt: number | null   // Date.now() of last state change
  reconnectAttempts: number
  snapshotError: string | null      // set if get-game-state fails after reconnect

  setConnected: () => void
  setReconnecting: () => void
  setDisconnected: () => void
  incrementReconnectAttempts: () => void
  setSnapshotError: (error: string | null) => void
  reset: () => void
}

const INITIAL: Pick<
  ConnectionStoreState,
  'connectionState' | 'lastTransitionAt' | 'reconnectAttempts' | 'snapshotError'
> = {
  connectionState: 'CONNECTED',
  lastTransitionAt: null,
  reconnectAttempts: 0,
  snapshotError: null,
}

export const useConnectionStore = create<ConnectionStoreState>()((set) => ({
  ...INITIAL,

  setConnected: () =>
    set({ connectionState: 'CONNECTED', lastTransitionAt: Date.now(), reconnectAttempts: 0, snapshotError: null }),

  setReconnecting: () =>
    set((state) =>
      state.connectionState === 'RECONNECTING'
        ? state  // already reconnecting — don't reset the timestamp
        : { connectionState: 'RECONNECTING', lastTransitionAt: Date.now() }
    ),

  setDisconnected: () =>
    set({ connectionState: 'DISCONNECTED', lastTransitionAt: Date.now() }),

  incrementReconnectAttempts: () =>
    set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 })),

  setSnapshotError: (error) => set({ snapshotError: error }),

  reset: () => set(INITIAL),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

export const selectIsConnected = (state: ConnectionStoreState) =>
  state.connectionState === 'CONNECTED'

export const selectIsReconnecting = (state: ConnectionStoreState) =>
  state.connectionState === 'RECONNECTING'
