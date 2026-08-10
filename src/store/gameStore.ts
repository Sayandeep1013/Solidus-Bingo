/**
 * src/store/gameStore.ts — Game_Store (Zustand)
 *
 * Owns all in-game state: board, called numbers, scores, completed lines,
 * active player, winner.
 *
 * Reset points (spec bingo-state-management §Req reset):
 *   - New_Game / Rematch → reset() called before new game data arrives
 *   - Logout / Leave_Room → reset() called by those handlers
 *
 * No optimistic updates — state is only updated from confirmed Realtime events
 * or from Edge Function responses.
 */
import { create } from 'zustand'
import type { LineId } from '../lib/gameEngine'
import type { CompletedLine, GameStatus } from '../types/game'

// ─── State shape ──────────────────────────────────────────────────────────────

interface GameState {
  gameId: string | null
  gameNumber: number | null
  gameStatus: GameStatus | null

  /** The current player's own board (flat 25-element array). null until game starts. */
  myBoard: number[] | null

  /** All numbers called so far, in call order */
  calledNumbers: number[]

  /** playerId → current score */
  scoreMap: Record<string, number>

  /** All completed line events so far */
  completedLines: CompletedLine[]

  /** Player who currently holds the active turn. null when game not active. */
  activePlayerId: string | null

  /** Set when game is FINISHED. null until then. */
  winnerId: string | null

  /** The winning call number. null until FINISHED. */
  winningCall: number | null

  /** The sequence number of the last successfully applied call */
  lastCallSequence: number

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Called when a game becomes active (from get-game-state snapshot or start-game response) */
  setGameActive: (args: {
    gameId: string
    gameNumber?: number | null
    myBoard: number[]
    activePlayerId: string
    initialScores: Record<string, number>
    initialCalledNumbers?: number[]
    initialCompletedLines?: CompletedLine[]
    lastCallSequence?: number
  }) => void

  /**
   * Apply a confirmed call from a game_calls INSERT Realtime event.
   * Idempotent: if number already in calledNumbers, does nothing.
   */
  applyCall: (args: {
    number: number
    sequence: number
    newActivePlayerId: string | null
    newlyCompletedLines: CompletedLine[]
    updatedScores: Record<string, number>
  }) => void

  /** Apply score update from a game_players UPDATE Realtime event */
  updateScore: (playerId: string, score: number) => void

  /** Apply a completed line from a game_completed_lines INSERT Realtime event */
  applyCompletedLine: (line: CompletedLine) => void

  /** Apply game status / active player update from a games UPDATE Realtime event */
  updateActivePlayer: (activePlayerId: string | null) => void
  updateGameStatus: (status: GameStatus, winnerId?: string | null, winningCall?: number | null) => void

  setGameFinished: (args: {
    winnerId: string | null
    winningCall: number | null
    finalScores: Record<string, number>
  }) => void

  reset: () => void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL: Pick<
  GameState,
  | 'gameId' | 'gameNumber' | 'gameStatus' | 'myBoard' | 'calledNumbers'
  | 'scoreMap' | 'completedLines' | 'activePlayerId'
  | 'winnerId' | 'winningCall' | 'lastCallSequence'
> = {
  gameId: null,
  gameNumber: null,
  gameStatus: null,
  myBoard: null,
  calledNumbers: [],
  scoreMap: {},
  completedLines: [],
  activePlayerId: null,
  winnerId: null,
  winningCall: null,
  lastCallSequence: 0,
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameState>()((set, get) => ({
  ...INITIAL,

  setGameActive: ({
    gameId,
    gameNumber = null,
    myBoard,
    activePlayerId,
    initialScores,
    initialCalledNumbers = [],
    initialCompletedLines = [],
    lastCallSequence = 0,
  }) =>
    set({
      gameId,
      gameNumber,
      gameStatus: 'ACTIVE',
      myBoard,
      activePlayerId,
      scoreMap: initialScores,
      calledNumbers: initialCalledNumbers,
      completedLines: initialCompletedLines,
      lastCallSequence,
      winnerId: null,
      winningCall: null,
    }),

  applyCall: ({ number, sequence, newActivePlayerId, newlyCompletedLines, updatedScores }) =>
    set((state) => {
      // Idempotent: skip if already applied
      if (state.calledNumbers.includes(number)) return state

      return {
        calledNumbers: [...state.calledNumbers, number],
        lastCallSequence: sequence,
        activePlayerId: newActivePlayerId,
        // Merge new completed lines (deduplicate by player+line pair)
        completedLines: mergeLines(state.completedLines, newlyCompletedLines),
        scoreMap: { ...state.scoreMap, ...updatedScores },
      }
    }),

  updateScore: (playerId, score) =>
    set((state) => ({
      scoreMap: { ...state.scoreMap, [playerId]: score },
    })),

  applyCompletedLine: (line) =>
    set((state) => ({
      completedLines: mergeLines(state.completedLines, [line]),
    })),

  updateActivePlayer: (activePlayerId) => set({ activePlayerId }),

  updateGameStatus: (status, winnerId = null, winningCall = null) =>
    set({ gameStatus: status, winnerId, winningCall }),

  setGameFinished: ({ winnerId, winningCall, finalScores }) =>
    set({
      gameStatus: 'FINISHED',
      winnerId,
      winningCall,
      activePlayerId: null,
      scoreMap: { ...get().scoreMap, ...finalScores },
    }),

  reset: () => set(INITIAL),
}))

// ─── Helper ───────────────────────────────────────────────────────────────────

function mergeLines(existing: CompletedLine[], incoming: CompletedLine[]): CompletedLine[] {
  const seen = new Set(existing.map((l) => `${l.playerId}:${l.lineId}`))
  const toAdd = incoming.filter((l) => !seen.has(`${l.playerId}:${l.lineId}`))
  return toAdd.length === 0 ? existing : [...existing, ...toAdd]
}

// ─── Derived selectors ────────────────────────────────────────────────────────

/** True if it is the given player's turn */
export const selectIsMyTurn = (myUserId: string | null) => (state: GameState) =>
  state.gameStatus === 'ACTIVE' && state.activePlayerId === myUserId

/** Numbers not yet called — for display purposes */
export const selectUncalledNumbers = (state: GameState): number[] => {
  const called = new Set(state.calledNumbers)
  return Array.from({ length: 25 }, (_, i) => i + 1).filter((n) => !called.has(n))
}

/** My score from the scoreMap */
export const selectMyScore = (myUserId: string | null) => (state: GameState) =>
  myUserId ? (state.scoreMap[myUserId] ?? 0) : 0

/** My completed line IDs */
export const selectMyCompletedLines = (myUserId: string | null) => (state: GameState): LineId[] =>
  myUserId
    ? state.completedLines.filter((l) => l.playerId === myUserId).map((l) => l.lineId)
    : []

/**
 * Derived board: which cells on myBoard are "cut" (their number has been called).
 * Returns a Set of board indices (0–24) that are cut.
 */
export const selectMyCutIndices = (state: GameState): Set<number> => {
  if (!state.myBoard) return new Set()
  const called = new Set(state.calledNumbers)
  const cut = new Set<number>()
  state.myBoard.forEach((val, idx) => {
    if (called.has(val)) cut.add(idx)
  })
  return cut
}
