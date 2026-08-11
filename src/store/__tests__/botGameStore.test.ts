/**
 * src/store/__tests__/botGameStore.test.ts
 *
 * Win-attribution regression tests for practice mode.
 *
 * Reported from a live game: the player finished with 5 lines to Bot Ada's 3,
 * and the result screen read "Bot Ada Wins" — because the bot had called the
 * number that completed the player's fifth line and the old rule handed the win
 * to whoever called. The rule is now "the player whose own board reached 5 wins,
 * caller breaks a tie" (spec bingo-game-mechanics §5.3–5.4), and these tests
 * pin both halves of it.
 */
import { useBotGameStore, HUMAN_PLAYER_ID, type BotSeat } from '../botGameStore'
import type { LineId } from '../../lib/gameEngine'
import type { CompletedLine } from '../../types/game'

const BOT_ID = 'bot-1'

/** Board holding 1–25 in reading order: row_0 is 1–5, row_1 is 6–10, and so on. */
const ORDERED_BOARD = Array.from({ length: 25 }, (_, i) => i + 1)

/**
 * A board that completes as few lines as possible once 1–21 are called: the
 * four uncalled numbers (22–25) sit on indices 0/6/12/18, which between them
 * break every line except row_4 and col_4.
 */
const SPARSE_BOARD = [
  22, 1, 2, 3, 4,
  5, 23, 6, 7, 8,
  9, 10, 24, 11, 12,
  13, 14, 15, 25, 16,
  17, 18, 19, 20, 21,
]

const PLAYERS: BotSeat[] = [
  { playerId: HUMAN_PLAYER_ID, displayName: 'You', isBot: false, turnOrder: 1 },
  { playerId: BOT_ID, displayName: 'Bot Ada', isBot: true, turnOrder: 2 },
]

/** 1–20 called: on ORDERED_BOARD that is exactly row_0…row_3 and nothing else. */
const CALLED_1_TO_20 = Array.from({ length: 20 }, (_, i) => i + 1)
const FOUR_ROWS: LineId[] = ['row_0', 'row_1', 'row_2', 'row_3']

function linesFor(playerId: string): CompletedLine[] {
  return FOUR_ROWS.map((lineId) => ({ playerId, lineId, completingCallSequence: 20 }))
}

afterEach(() => useBotGameStore.getState().reset())

describe('botGameStore — win attribution', () => {
  test("the bot calling the number that completes YOUR fifth line does not win it the game", () => {
    useBotGameStore.setState({
      players: PLAYERS,
      boards: { [HUMAN_PLAYER_ID]: ORDERED_BOARD, [BOT_ID]: SPARSE_BOARD },
      calledNumbers: CALLED_1_TO_20,
      scoreMap: { [HUMAN_PLAYER_ID]: 4, [BOT_ID]: 0 },
      completedLines: linesFor(HUMAN_PLAYER_ID),
      activePlayerId: BOT_ID,
      winnerId: null,
      winningCall: null,
      status: 'ACTIVE',
    })

    // 21 completes col_0 and diag_anti on the human board (4 → 6 lines) while
    // only completing row_4 and col_4 on the bot's (0 → 2).
    useBotGameStore.getState().callNumber(BOT_ID, 21)

    const s = useBotGameStore.getState()
    expect(s.status).toBe('FINISHED')
    expect(s.scoreMap[HUMAN_PLAYER_ID]).toBe(6)
    expect(s.scoreMap[BOT_ID]).toBe(2)
    expect(s.winnerId).toBe(HUMAN_PLAYER_ID)
    expect(s.winningCall).toBe(21)
  })

  test('a call that pushes both players to 5 at once is a shared victory, not the caller\'s', () => {
    useBotGameStore.setState({
      players: PLAYERS,
      boards: { [HUMAN_PLAYER_ID]: ORDERED_BOARD, [BOT_ID]: ORDERED_BOARD },
      calledNumbers: CALLED_1_TO_20,
      scoreMap: { [HUMAN_PLAYER_ID]: 4, [BOT_ID]: 4 },
      completedLines: [...linesFor(HUMAN_PLAYER_ID), ...linesFor(BOT_ID)],
      activePlayerId: BOT_ID,
      winnerId: null,
      winningCall: null,
      status: 'ACTIVE',
    })

    useBotGameStore.getState().callNumber(BOT_ID, 21)

    const s = useBotGameStore.getState()
    expect(s.status).toBe('FINISHED')
    expect(s.scoreMap[HUMAN_PLAYER_ID]).toBe(6)
    expect(s.scoreMap[BOT_ID]).toBe(6)
    expect(s.outcome).toBe('DRAW')
    // Nobody won it alone, so there is no winner to name.
    expect(s.winnerId).toBeNull()
    // Turn order, so a replay records the same set (spec §5.5).
    expect(s.coWinnerIds).toEqual([HUMAN_PLAYER_ID, BOT_ID])
  })

  test('in a 3-player practice game, two reaching 5 draw and the third is defeated', () => {
    const BOT_2 = 'bot-2'
    const three: BotSeat[] = [
      ...PLAYERS,
      { playerId: BOT_2, displayName: 'Bot Turing', isBot: true, turnOrder: 3 },
    ]

    useBotGameStore.setState({
      players: three,
      boards: {
        [HUMAN_PLAYER_ID]: ORDERED_BOARD,
        [BOT_ID]: ORDERED_BOARD,
        [BOT_2]: SPARSE_BOARD,
      },
      calledNumbers: CALLED_1_TO_20,
      scoreMap: { [HUMAN_PLAYER_ID]: 4, [BOT_ID]: 4, [BOT_2]: 0 },
      completedLines: [...linesFor(HUMAN_PLAYER_ID), ...linesFor(BOT_ID)],
      activePlayerId: BOT_2,
      winnerId: null,
      coWinnerIds: [],
      outcome: null,
      winningCall: null,
      status: 'ACTIVE',
    })

    // Called by the one player who does NOT reach 5 — they get nothing for it.
    useBotGameStore.getState().callNumber(BOT_2, 21)

    const s = useBotGameStore.getState()
    expect(s.outcome).toBe('DRAW')
    expect(s.coWinnerIds).toEqual([HUMAN_PLAYER_ID, BOT_ID])
    expect(s.scoreMap[BOT_2]).toBe(2)
    expect(s.winnerId).toBeNull()
  })

  test('calling your own winning number still wins it', () => {
    useBotGameStore.setState({
      players: PLAYERS,
      boards: { [HUMAN_PLAYER_ID]: ORDERED_BOARD, [BOT_ID]: SPARSE_BOARD },
      calledNumbers: CALLED_1_TO_20,
      scoreMap: { [HUMAN_PLAYER_ID]: 4, [BOT_ID]: 0 },
      completedLines: linesFor(HUMAN_PLAYER_ID),
      activePlayerId: HUMAN_PLAYER_ID,
      winnerId: null,
      winningCall: null,
      status: 'ACTIVE',
    })

    useBotGameStore.getState().callNumber(HUMAN_PLAYER_ID, 21)

    expect(useBotGameStore.getState().winnerId).toBe(HUMAN_PLAYER_ID)
  })
})
