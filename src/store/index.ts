/**
 * src/store/index.ts
 *
 * Re-exports all stores and provides reset utilities.
 *
 * Reset points (spec bingo-state-management):
 *   resetAllStores()    — Logout, App_Restart
 *   resetRoomStores()   — Leave_Room
 *   resetGameStore()    — New_Game / Rematch only
 */
export { useRoomStore, selectIAmHost, selectIsRoomFull, selectCanStartGame } from './roomStore'
export { useGameStore, selectIsMyTurn, selectUncalledNumbers, selectMyScore, selectMyCompletedLines, selectMyCutIndices } from './gameStore'
export { useConnectionStore, selectIsConnected, selectIsReconnecting } from './connectionStore'
export { usePresenceStore, selectIsPlayerOnline } from './presenceStore'

import { useRoomStore } from './roomStore'
import { useGameStore } from './gameStore'
import { useConnectionStore } from './connectionStore'
import { usePresenceStore } from './presenceStore'

/** Called on logout — clears every store */
export function resetAllStores() {
  useRoomStore.getState().reset()
  useGameStore.getState().reset()
  useConnectionStore.getState().reset()
  usePresenceStore.getState().reset()
}

/** Called when leaving a room — clears room + game + connection + presence */
export function resetRoomStores() {
  useRoomStore.getState().reset()
  useGameStore.getState().reset()
  useConnectionStore.getState().reset()
  usePresenceStore.getState().reset()
}

/** Called when a new game / rematch starts — clears only game state */
export function resetGameStore() {
  useGameStore.getState().reset()
}
