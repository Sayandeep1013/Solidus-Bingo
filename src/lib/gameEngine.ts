/**
 * src/lib/gameEngine.ts
 *
 * Core game logic — pure TypeScript functions, zero DB/network dependency.
 * All functions are deterministic (except board generation which uses Math.random)
 * and are designed to be fully testable with Jest + fast-check.
 *
 * References:
 *   bingo-game-mechanics spec — Req 1 (boards), Req 2 (turns), Req 4 (lines/scoring), Req 5 (win)
 *   bingo-testing spec — Req 2 (unit tests), Req 3 (PBT properties)
 *
 * Board layout: 25-element flat array, row-major order.
 *   Index mapping:  row r, col c  →  index = r * 5 + c
 *   [0,0]=idx 0  [0,4]=idx 4  [4,0]=idx 20  [4,4]=idx 24
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LineId =
  | 'row_0' | 'row_1' | 'row_2' | 'row_3' | 'row_4'
  | 'col_0' | 'col_1' | 'col_2' | 'col_3' | 'col_4'
  | 'diag_main' | 'diag_anti'

export const ALL_LINE_IDS: readonly LineId[] = [
  'row_0', 'row_1', 'row_2', 'row_3', 'row_4',
  'col_0', 'col_1', 'col_2', 'col_3', 'col_4',
  'diag_main', 'diag_anti',
]

export interface GamePlayer {
  playerId: string
  turnOrder: number // 1-based position in the circular turn sequence
}

// ─────────────────────────────────────────────────────────────────────────────
// Board generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a single random 5×5 board as a flat 25-element array.
 * Uses Fisher-Yates shuffle for a uniformly random permutation of 1–25.
 *
 * Spec: bingo-game-mechanics Req 1.2, 1.3, 1.7
 * - Each integer 1–25 appears exactly once (no free center space)
 * - Arrangement is uniformly random
 */
export function generateBoard(): number[] {
  // Start with [1, 2, ..., 25]
  const board = Array.from({ length: 25 }, (_, i) => i + 1)

  // Fisher-Yates in-place shuffle
  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[board[i], board[j]] = [board[j], board[i]]
  }

  return board
}

/**
 * Generates `n` unique boards for a game (no two share the same arrangement).
 *
 * Spec: bingo-game-mechanics Req 1.4, 1.8
 * - Retries until all boards are distinct (handles extremely unlikely duplicates)
 */
export function generateBoards(n: number): number[][] {
  const boards: number[][] = []
  const seen = new Set<string>()

  while (boards.length < n) {
    const board = generateBoard()
    const key = board.join(',')
    if (!seen.has(key)) {
      seen.add(key)
      boards.push(board)
    }
  }

  return boards
}

// ─────────────────────────────────────────────────────────────────────────────
// Line definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the 5 board indices (0–24) that make up the given line.
 * Indices are in row-major order: index = row * 5 + col.
 *
 * Spec: bingo-game-mechanics Req 4.7
 */
export function getLineIndices(lineId: LineId): number[] {
  if (lineId.startsWith('row_')) {
    const r = parseInt(lineId.slice(4), 10)
    return [0, 1, 2, 3, 4].map((c) => r * 5 + c)
  }
  if (lineId.startsWith('col_')) {
    const c = parseInt(lineId.slice(4), 10)
    return [0, 1, 2, 3, 4].map((r) => r * 5 + c)
  }
  if (lineId === 'diag_main') {
    // [0,0],[1,1],[2,2],[3,3],[4,4] → 0,6,12,18,24
    return [0, 6, 12, 18, 24]
  }
  if (lineId === 'diag_anti') {
    // [0,4],[1,3],[2,2],[3,1],[4,0] → 4,8,12,16,20
    return [4, 8, 12, 16, 20]
  }
  throw new Error(`Unknown lineId: ${lineId}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Line detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns ALL completed LineIds for the given board and set of called numbers.
 * A line is complete when all 5 cells on that line have been called.
 *
 * Spec: bingo-game-mechanics Req 4.1–4.2, 4.7
 */
export function detectCompletedLines(
  board: number[],
  calledNumbers: Set<number>
): LineId[] {
  const completed: LineId[] = []

  for (const lineId of ALL_LINE_IDS) {
    const indices = getLineIndices(lineId)
    const isComplete = indices.every((idx) => calledNumbers.has(board[idx]))
    if (isComplete) {
      completed.push(lineId)
    }
  }

  return completed
}

/**
 * Returns only the NEWLY completed lines resulting from the latest call.
 * Lines already in `alreadyCompleted` are excluded (scored exactly once).
 *
 * Spec: bingo-game-mechanics Req 4.3–4.5
 */
export function evaluateNewLines(
  board: number[],
  calledSet: Set<number>,
  alreadyCompleted: Set<LineId>
): LineId[] {
  const allNow = detectCompletedLines(board, calledSet)
  return allNow.filter((lineId) => !alreadyCompleted.has(lineId))
}

// ─────────────────────────────────────────────────────────────────────────────
// Win condition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if any player has a score of 5 or more.
 *
 * Spec: bingo-game-mechanics Req 5.1–5.3
 * - Win threshold is 5 completed lines
 */
export function checkWinCondition(scores: Map<string, number>): boolean {
  for (const score of scores.values()) {
    if (score >= 5) return true
  }
  return false
}

/**
 * Returns the player ID of the first player with score >= 5, or null if no winner.
 * Used to identify the winner when `checkWinCondition` is true.
 */
export function findWinner(scores: Map<string, number>): string | null {
  for (const [playerId, score] of scores.entries()) {
    if (score >= 5) return playerId
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advances the active turn to the next player in the circular turn order.
 * Players are sorted by `turnOrder` (1-based). Wraps from last → first.
 *
 * Spec: bingo-game-mechanics Req 2.2–2.3
 *
 * @param players  All players in the game with their turn orders
 * @param currentPlayerId  The player who just made a successful call
 * @returns The player ID of the next player
 */
export function advanceTurn(players: GamePlayer[], currentPlayerId: string): string {
  if (players.length === 0) {
    throw new Error('advanceTurn: players array is empty')
  }

  // Sort by turn order to establish the fixed circular sequence
  const sorted = [...players].sort((a, b) => a.turnOrder - b.turnOrder)
  const currentIndex = sorted.findIndex((p) => p.playerId === currentPlayerId)

  if (currentIndex === -1) {
    throw new Error(`advanceTurn: currentPlayerId "${currentPlayerId}" not found in players`)
  }

  const nextIndex = (currentIndex + 1) % sorted.length
  return sorted[nextIndex].playerId
}
