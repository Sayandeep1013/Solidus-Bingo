/**
 * src/types/game.ts
 *
 * Shared types for Room, Game, Connection and Presence state.
 * Used by Zustand stores, Realtime hooks, and UI components.
 */
import type { LineId } from '../lib/gameEngine'

// ─── Room ────────────────────────────────────────────────────────────────────

export type RoomStatus =
  | 'CREATED' | 'WAITING' | 'FULL' | 'IN_GAME'
  | 'GAME_FINISHED' | 'REMATCH_WAITING' | 'CLOSED'

export interface RoomPlayer {
  playerId: string
  username: string | null
  joinOrder: number
  isOnline: boolean        // from Presence — false = disconnected (30s grace)
}

// ─── Game ────────────────────────────────────────────────────────────────────

export type GameStatus =
  | 'CREATED' | 'LOBBY' | 'STARTING' | 'ACTIVE'
  | 'FINISHED' | 'CANCELLED' | 'ABANDONED'

export interface CompletedLine {
  playerId: string
  lineId: LineId
  completingCallSequence: number
}

// ─── Connection ───────────────────────────────────────────────────────────────

export type ConnectionState = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'

// ─── Presence ─────────────────────────────────────────────────────────────────

export interface PresenceEntry {
  playerId: string
  username: string | null
  onlineAt: string   // ISO timestamp
}
