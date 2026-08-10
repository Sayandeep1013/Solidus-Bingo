/**
 * src/store/presenceStore.ts — Presence_Sub_Store (Zustand)
 *
 * Tracks who is currently online in the room channel via Supabase Presence.
 * Presence is a separate concern from room_players — a player can be in
 * room_players (ACTIVE) but offline in presence (disconnected, 30s grace).
 *
 * Reset: on logout or leave-room.
 */
import { create } from 'zustand'
import type { PresenceEntry } from '../types/game'

interface PresenceStoreState {
  /** keyed by playerId */
  presenceRoster: Record<string, PresenceEntry>

  syncPresence: (roster: PresenceEntry[]) => void
  playerJoinedPresence: (entry: PresenceEntry) => void
  playerLeftPresence: (playerId: string) => void
  reset: () => void
}

export const usePresenceStore = create<PresenceStoreState>()((set) => ({
  presenceRoster: {},

  syncPresence: (roster) => {
    const map: Record<string, PresenceEntry> = {}
    for (const entry of roster) map[entry.playerId] = entry
    set({ presenceRoster: map })
  },

  playerJoinedPresence: (entry) =>
    set((state) => ({
      presenceRoster: { ...state.presenceRoster, [entry.playerId]: entry },
    })),

  playerLeftPresence: (playerId) =>
    set((state) => {
      const next = { ...state.presenceRoster }
      delete next[playerId]
      return { presenceRoster: next }
    }),

  reset: () => set({ presenceRoster: {} }),
}))

// ─── Derived selector ─────────────────────────────────────────────────────────

/** True if the given playerId is currently tracked in presence (online) */
export const selectIsPlayerOnline =
  (playerId: string) => (state: PresenceStoreState) =>
    playerId in state.presenceRoster
