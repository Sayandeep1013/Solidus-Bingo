/**
 * src/store/botGameStore.ts — local-only single-player practice mode state.
 *
 * Spec: .kiro/specs/bingo-play-vs-bot/requirements.md
 *
 * Deliberately NOT part of src/store/index.ts's resetAllStores() group and
 * NEVER touches roomStore/gameStore — a Bot_Session has no room, no game_id,
 * no Supabase writes of any kind, and must never be able to leak into or be
 * confused with multiplayer/ranked state (which is what the Leaderboard's
 * anti-manipulation guarantee depends on).
 *
 * Mirrors the exact win rule used server-side by supabase/functions/call-number:
 * the winner is whoever CALLED the number that pushed any player to 5 lines,
 * not necessarily the player whose own board completed a line.
 */
import { create } from 'zustand'
import {
  generateBoards,
  evaluateNewLines,
  advanceTurn,
  type LineId,
  type GamePlayer,
} from '../lib/gameEngine'
import type { CompletedLine, GameStatus } from '../types/game'

export const HUMAN_PLAYER_ID = 'human'

const BOT_NAMES = ['Bot Ada', 'Bot Turing', 'Bot Grace']

export interface BotSeat {
  playerId: string
  displayName: string
  isBot: boolean
  turnOrder: number
}

interface BotGameState {
  players: BotSeat[]
  boards: Record<string, number[]>
  calledNumbers: number[]
  scoreMap: Record<string, number>
  completedLines: CompletedLine[]
  activePlayerId: string | null
  winnerId: string | null
  winningCall: number | null
  status: GameStatus | null

  /** totalPlayers includes the human — 2, 3, or 4 */
  startSession: (totalPlayers: 2 | 3 | 4) => void

  /** Applies a call exactly like the call-number Edge Function would. No-op if invalid. */
  callNumber: (callerId: string, num: number) => void

  reset: () => void
}

const INITIAL: Pick<
  BotGameState,
  | 'players' | 'boards' | 'calledNumbers' | 'scoreMap' | 'completedLines'
  | 'activePlayerId' | 'winnerId' | 'winningCall' | 'status'
> = {
  players: [],
  boards: {},
  calledNumbers: [],
  scoreMap: {},
  completedLines: [],
  activePlayerId: null,
  winnerId: null,
  winningCall: null,
  status: null,
}

export const useBotGameStore = create<BotGameState>()((set, get) => ({
  ...INITIAL,

  startSession: (totalPlayers) => {
    const numBots = totalPlayers - 1
    const players: BotSeat[] = [
      { playerId: HUMAN_PLAYER_ID, displayName: 'You', isBot: false, turnOrder: 1 },
      ...Array.from({ length: numBots }, (_, i) => ({
        playerId: `bot-${i + 1}`,
        displayName: BOT_NAMES[i % BOT_NAMES.length],
        isBot: true,
        turnOrder: i + 2,
      })),
    ]

    const boardsList = generateBoards(totalPlayers)
    const boards: Record<string, number[]> = {}
    players.forEach((p, i) => { boards[p.playerId] = boardsList[i] })

    const scoreMap: Record<string, number> = {}
    players.forEach((p) => { scoreMap[p.playerId] = 0 })

    const firstPlayer = players[Math.floor(Math.random() * players.length)]

    set({
      players,
      boards,
      scoreMap,
      calledNumbers: [],
      completedLines: [],
      activePlayerId: firstPlayer.playerId,
      winnerId: null,
      winningCall: null,
      status: 'ACTIVE',
    })
  },

  callNumber: (callerId, num) => {
    const state = get()
    if (state.status !== 'ACTIVE') return
    if (state.activePlayerId !== callerId) return
    if (num < 1 || num > 25 || state.calledNumbers.includes(num)) return

    const calledSet = new Set([...state.calledNumbers, num])

    const alreadyCompletedByPlayer = new Map<string, Set<LineId>>()
    for (const line of state.completedLines) {
      if (!alreadyCompletedByPlayer.has(line.playerId)) {
        alreadyCompletedByPlayer.set(line.playerId, new Set())
      }
      alreadyCompletedByPlayer.get(line.playerId)!.add(line.lineId)
    }

    const newlyCompleted: CompletedLine[] = []
    for (const player of state.players) {
      const board = state.boards[player.playerId]
      const already = alreadyCompletedByPlayer.get(player.playerId) ?? new Set<LineId>()
      const newLines = evaluateNewLines(board, calledSet, already)
      for (const lineId of newLines) {
        newlyCompleted.push({ playerId: player.playerId, lineId, completingCallSequence: calledSet.size })
      }
    }

    const scoreMap = { ...state.scoreMap }
    for (const line of newlyCompleted) {
      scoreMap[line.playerId] = (scoreMap[line.playerId] ?? 0) + 1
    }

    const winnerExists = Object.values(scoreMap).some((s) => s >= 5)

    if (winnerExists) {
      // Winner = the calling player, captured before clearing active turn —
      // matches call-number's Win Path ordering exactly.
      set({
        calledNumbers: [...state.calledNumbers, num],
        completedLines: [...state.completedLines, ...newlyCompleted],
        scoreMap,
        activePlayerId: null,
        winnerId: callerId,
        winningCall: num,
        status: 'FINISHED',
      })
      return
    }

    if (calledSet.size === 25) {
      set({
        calledNumbers: [...state.calledNumbers, num],
        completedLines: [...state.completedLines, ...newlyCompleted],
        scoreMap,
        activePlayerId: null,
        status: 'ABANDONED',
      })
      return
    }

    const turnOrderPlayers: GamePlayer[] = state.players.map((p) => ({
      playerId: p.playerId,
      turnOrder: p.turnOrder,
    }))
    const nextPlayerId = advanceTurn(turnOrderPlayers, callerId)

    set({
      calledNumbers: [...state.calledNumbers, num],
      completedLines: [...state.completedLines, ...newlyCompleted],
      scoreMap,
      activePlayerId: nextPlayerId,
    })
  },

  reset: () => set(INITIAL),
}))

/** Derived: cells on a given player's board that have been called */
export function selectCutIndices(board: number[] | undefined, calledNumbers: number[]): Set<number> {
  if (!board) return new Set()
  const called = new Set(calledNumbers)
  const cut = new Set<number>()
  board.forEach((val, idx) => { if (called.has(val)) cut.add(idx) })
  return cut
}
