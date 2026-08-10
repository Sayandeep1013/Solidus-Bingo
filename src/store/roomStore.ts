/**
 * src/store/roomStore.ts — Room_Store (Zustand)
 *
 * Owns all room/lobby state: room metadata, player list, rematch vote count.
 *
 * Reset points (spec bingo-state-management §Req reset):
 *   - Logout → reset() called by auth logout handler
 *   - Leave_Room → reset() called by leave-room action
 *   - New_Game/Rematch → do NOT reset (room data persists across games)
 *
 * No optimistic updates — state is only mutated from Realtime events
 * or from Edge Function response handlers.
 */
import { create } from 'zustand'
import type { RoomPlayer, RoomStatus } from '../types/game'

// ─── State shape ──────────────────────────────────────────────────────────────

interface RoomState {
  roomId: string | null
  roomCode: string | null
  capacity: number | null
  roomStatus: RoomStatus | null
  hostId: string | null
  players: RoomPlayer[]           // ordered by joinOrder
  rematchVoteCount: number

  // ── Actions ──────────────────────────────────────────────────────────────
  setRoom: (room: {
    roomId: string
    roomCode: string | null // null for ranked rooms — matchmade, never shared by code
    capacity: number
    roomStatus: RoomStatus
    hostId: string
    players: RoomPlayer[]
  }) => void

  updateRoomStatus: (status: RoomStatus) => void
  updateHostId: (hostId: string) => void

  /** INSERT event from room_players */
  upsertPlayer: (player: RoomPlayer) => void

  /** UPDATE event from room_players (status LEFT/KICKED, or online change) */
  updatePlayer: (playerId: string, updates: Partial<RoomPlayer>) => void

  updateRematchVoteCount: (count: number) => void
  incrementRematchVoteCount: () => void

  reset: () => void
}

// ─── Initial state ─────────────────────────────────────────────────────────

const INITIAL: Pick<
  RoomState,
  'roomId' | 'roomCode' | 'capacity' | 'roomStatus' | 'hostId' | 'players' | 'rematchVoteCount'
> = {
  roomId: null,
  roomCode: null,
  capacity: null,
  roomStatus: null,
  hostId: null,
  players: [],
  rematchVoteCount: 0,
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useRoomStore = create<RoomState>()((set) => ({
  ...INITIAL,

  setRoom: ({ roomId, roomCode, capacity, roomStatus, hostId, players }) =>
    set({ roomId, roomCode, capacity, roomStatus, hostId, players, rematchVoteCount: 0 }),

  updateRoomStatus: (status) => set({ roomStatus: status }),

  updateHostId: (hostId) => set({ hostId }),

  upsertPlayer: (player) =>
    set((state) => {
      const existing = state.players.findIndex((p) => p.playerId === player.playerId)
      if (existing !== -1) {
        // Update existing (idempotent — same player joining twice is a no-op)
        const updated = [...state.players]
        updated[existing] = { ...updated[existing], ...player }
        return { players: updated }
      }
      // Add new player, keep sorted by joinOrder
      return {
        players: [...state.players, player].sort((a, b) => a.joinOrder - b.joinOrder),
      }
    }),

  updatePlayer: (playerId, updates) =>
    set((state) => ({
      players: state.players.map((p) =>
        p.playerId === playerId ? { ...p, ...updates } : p
      ),
    })),

  updateRematchVoteCount: (count) => set({ rematchVoteCount: count }),

  incrementRematchVoteCount: () =>
    set((state) => ({ rematchVoteCount: state.rematchVoteCount + 1 })),

  reset: () => set(INITIAL),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

/** True if current user is the room host */
export const selectIAmHost = (myUserId: string | null) => (state: RoomState) =>
  state.hostId !== null && state.hostId === myUserId

/** True if room is at capacity (roomStatus === FULL or IN_GAME) */
export const selectIsRoomFull = (state: RoomState) =>
  state.roomStatus === 'FULL' || state.roomStatus === 'IN_GAME'

/** True if host, room is FULL, and connection is CONNECTED */
export const selectCanStartGame = (
  myUserId: string | null,
  isConnected: boolean
) => (state: RoomState) =>
  selectIAmHost(myUserId)(state) && selectIsRoomFull(state) && isConnected
