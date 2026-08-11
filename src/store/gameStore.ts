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

  /**
   * When the CURRENT turn began (server timestamp) — the chess-clock
   * reference point. The active player's live countdown is computed
   * client-side as timeRemainingMs[activePlayerId] - (now - turnStartedAt);
   * every other player's bank is frozen at whatever timeRemainingMs holds.
   * Spec: bingo-disconnect-recovery §3.2.
   */
  turnStartedAt: string | null

  /** playerId → time remaining in ms, as of the last server sync (frozen
   * for whoever isn't currently active). */
  timeRemainingMs: Record<string, number>

  /** playerId → true once they've left turn rotation (timeout, forfeit
   * vote, or self-forfeit) — spec bingo-disconnect-recovery §3.6. */
  outPlayerIds: Record<string, boolean>

  /** playerId → true while a failed forfeit vote has handed their seat to
   * the bot (spec §3.5) — distinct from outPlayerIds: a bot-controlled seat
   * is still in turn rotation, just not being played by the real player
   * right now. Cleared the instant they reconnect (reclaim-seat). */
  botControlledPlayerIds: Record<string, boolean>

  /**
   * The single forfeit vote currently in flight against a disconnected
   * player, if any (null otherwise). Phase 4 only renders UI for this in
   * 2-player games (spec §3.4.1); 3-4p tally UI is Phase 5. Populated from
   * the initiate-disconnect-resolution response and kept live via the
   * forfeit_votes Realtime subscription.
   */
  pendingForfeitVote: {
    voteId: string
    targetPlayerId: string
    status: 'PENDING' | 'PASSED' | 'FAILED'
    expiresAt: string
  } | null

  /**
   * voterPlayerId → their ballot, for the currently pending forfeit vote.
   * 3-4p tally UI (spec §3.4.2 "the tally is visible live to all voters as
   * it comes in"); unused by the 2p prompt, which only cares about its own
   * single voter. Cleared whenever pendingForfeitVote's voteId changes.
   */
  forfeitVoteBallots: Record<string, 'YES' | 'NO'>

  /** Set when a single player won. Stays null on a DRAW — see coWinnerIds. */
  winnerId: string | null

  /**
   * Everyone who reached 5 on the same deciding call. Non-empty only when
   * outcome is DRAW, in which case winnerId is null because nobody won alone.
   */
  coWinnerIds: string[]

  /**
   * How the game ended. DRAW (several players reached 5 together) is a
   * different thing from ABANDONED (all 25 called, nobody got there), and the
   * result screen says different things about them.
   */
  outcome: 'WINNER' | 'DRAW' | 'CANCELLED' | 'ABANDONED' | null

  /** The winning call number. null until FINISHED. */
  winningCall: number | null

  /** The sequence number of the last successfully applied call */
  lastCallSequence: number

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Called when a game becomes active (from get-game-state snapshot or start-game response) */
  setGameActive: (args: {
    gameId: string
    gameNumber?: number | null
    myBoard: number[] | null
    activePlayerId: string
    initialScores: Record<string, number>
    initialCalledNumbers?: number[]
    initialCompletedLines?: CompletedLine[]
    lastCallSequence?: number
    turnStartedAt?: string | null
    initialTimeRemainingMs?: Record<string, number>
    initialOutPlayerIds?: Record<string, boolean>
    initialBotControlledPlayerIds?: Record<string, boolean>
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

  /** Apply a time-bank update from a game_players UPDATE Realtime event */
  updateTimeRemaining: (playerId: string, ms: number) => void

  /** Apply an is_out update from a game_players UPDATE Realtime event */
  updatePlayerOut: (playerId: string, isOut: boolean) => void

  /** Apply a bot_controlled update from a game_players UPDATE Realtime event */
  updateBotControlled: (playerId: string, botControlled: boolean) => void

  /** Apply a forfeit_votes INSERT/UPDATE Realtime event, or clear it */
  setPendingForfeitVote: (vote: GameState['pendingForfeitVote']) => void

  /** Apply a forfeit_vote_ballots INSERT/UPDATE Realtime event */
  upsertForfeitVoteBallot: (voterPlayerId: string, choice: 'YES' | 'NO') => void

  /** Apply a completed line from a game_completed_lines INSERT Realtime event */
  applyCompletedLine: (line: CompletedLine) => void

  /** Apply game status / active player update from a games UPDATE Realtime event */
  updateActivePlayer: (activePlayerId: string | null, turnStartedAt?: string | null) => void
  updateGameStatus: (status: GameStatus, winnerId?: string | null, winningCall?: number | null) => void

  /** Applied from the game_results row once a finished game's snapshot lands. */
  setGameResult: (result: {
    outcome: 'WINNER' | 'DRAW' | 'CANCELLED' | 'ABANDONED'
    coWinnerIds: string[]
  }) => void

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
  | 'winnerId' | 'coWinnerIds' | 'outcome' | 'winningCall' | 'lastCallSequence'
  | 'turnStartedAt' | 'timeRemainingMs' | 'outPlayerIds' | 'botControlledPlayerIds'
  | 'pendingForfeitVote' | 'forfeitVoteBallots'
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
  coWinnerIds: [],
  outcome: null,
  winningCall: null,
  lastCallSequence: 0,
  turnStartedAt: null,
  timeRemainingMs: {},
  outPlayerIds: {},
  botControlledPlayerIds: {},
  pendingForfeitVote: null,
  forfeitVoteBallots: {},
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
    turnStartedAt = null,
    initialTimeRemainingMs = {},
    initialOutPlayerIds = {},
    initialBotControlledPlayerIds = {},
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
      turnStartedAt,
      timeRemainingMs: initialTimeRemainingMs,
      outPlayerIds: initialOutPlayerIds,
      botControlledPlayerIds: initialBotControlledPlayerIds,
      pendingForfeitVote: null,
      forfeitVoteBallots: {},
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

  updateTimeRemaining: (playerId, ms) =>
    set((state) => ({
      timeRemainingMs: { ...state.timeRemainingMs, [playerId]: ms },
    })),

  updatePlayerOut: (playerId, isOut) =>
    set((state) => ({
      outPlayerIds: { ...state.outPlayerIds, [playerId]: isOut },
    })),

  updateBotControlled: (playerId, botControlled) =>
    set((state) => ({
      botControlledPlayerIds: { ...state.botControlledPlayerIds, [playerId]: botControlled },
    })),

  setPendingForfeitVote: (vote) =>
    set((state) => {
      // A new vote (different id) starts with a clean tally; clearing to
      // null also clears it so a later vote against the same target
      // doesn't inherit stale ballots from a prior, already-resolved one.
      const isNewVote = vote?.voteId !== state.pendingForfeitVote?.voteId
      return isNewVote ? { pendingForfeitVote: vote, forfeitVoteBallots: {} } : { pendingForfeitVote: vote }
    }),

  upsertForfeitVoteBallot: (voterPlayerId, choice) =>
    set((state) => ({
      forfeitVoteBallots: { ...state.forfeitVoteBallots, [voterPlayerId]: choice },
    })),

  applyCompletedLine: (line) =>
    set((state) => ({
      completedLines: mergeLines(state.completedLines, [line]),
    })),

  updateActivePlayer: (activePlayerId, turnStartedAt) =>
    set(turnStartedAt !== undefined ? { activePlayerId, turnStartedAt } : { activePlayerId }),

  updateGameStatus: (status, winnerId = null, winningCall = null) =>
    set({ gameStatus: status, winnerId, winningCall }),

  setGameResult: ({ outcome, coWinnerIds }) => set({ outcome, coWinnerIds }),

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
