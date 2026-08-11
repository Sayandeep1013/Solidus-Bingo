/**
 * src/lib/__tests__/resolveOutcome.test.ts
 *
 * The E1–E12 edge-case table from bingo-game-mechanics §5, one test each.
 *
 * resolveCall.ts on the server mirrors this logic by hand (Deno cannot import
 * from src/), so this file is the specification both implementations are held
 * to. If the rule changes here it must change there in the same commit.
 */
import { resolveOutcome, WIN_THRESHOLD, TOTAL_NUMBERS } from '../gameEngine'
import type { OutcomePlayer } from '../gameEngine'

const P = (playerId: string, turnOrder: number, isOut = false): OutcomePlayer => ({
  playerId,
  turnOrder,
  isOut,
})

/** A 4-player table, seated in turn order. */
const FOUR = [P('a', 1), P('b', 2), P('c', 3), P('d', 4)]
const TWO = [P('a', 1), P('b', 2)]

/** Mid-game: plenty of numbers left, so exhaustion is never the reason. */
const MID = 12

describe('resolveOutcome — single winner', () => {
  test('E1: the player at 5 wins even though someone else called the number', () => {
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: WIN_THRESHOLD, b: 3 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'WINNER', winnerId: 'a' })
  })

  test('E2: the player at 5 wins when they called it themselves', () => {
    // Identical shape — which is the point. The caller is not an input at all,
    // so it cannot influence the result.
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: 3, b: WIN_THRESHOLD },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'WINNER', winnerId: 'b' })
  })

  test('E9: 6+ lines counts the same as exactly 5', () => {
    // One call can complete a row and a diagonal together, jumping 4 → 6.
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: 6, b: 3 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'WINNER', winnerId: 'a' })
  })
})

describe('resolveOutcome — shared victory', () => {
  test('E3: two players at 5 on the same call draw, and the other two are defeated', () => {
    const outcome = resolveOutcome({
      players: FOUR,
      scores: { a: WIN_THRESHOLD, b: 3, c: WIN_THRESHOLD, d: 1 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'c'] })
  })

  test('E4: three players at 5 draw', () => {
    const outcome = resolveOutcome({
      players: FOUR,
      scores: { a: 5, b: 5, c: 2, d: 7 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'b', 'd'] })
  })

  test('E5: everyone reaching 5 together is a draw with nobody defeated', () => {
    const outcome = resolveOutcome({
      players: FOUR,
      scores: { a: 5, b: 5, c: 5, d: 5 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'b', 'c', 'd'] })
  })

  test('E6: being the caller confers nothing — still a draw', () => {
    // The caller is deliberately not a parameter. This test exists to pin that
    // absence: the old rule handed the win to whoever called.
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: 5, b: 5 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'b'] })
  })

  test('E5/§5.5: co-winners come back in turn order, not player-array order', () => {
    const shuffled = [P('d', 4), P('b', 2), P('a', 1), P('c', 3)]
    const outcome = resolveOutcome({
      players: shuffled,
      scores: { a: 5, b: 5, c: 5, d: 5 },
      callSequence: MID,
    })
    // Byte-identical on replay regardless of the order rows came back from the DB.
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'b', 'c', 'd'] })
  })
})

describe('resolveOutcome — players who are out', () => {
  test('E7: an out player at 5 is not a co-winner, leaving a single winner', () => {
    const outcome = resolveOutcome({
      players: [P('a', 1), P('b', 2, true)],
      scores: { a: 5, b: 5 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'WINNER', winnerId: 'a' })
  })

  test('E8: when only out players are at 5, nobody wins and play continues', () => {
    // Boards keep scoring after a forfeit, so this is reachable, and it must
    // not hand the game to someone who already left.
    const outcome = resolveOutcome({
      players: [P('a', 1, true), P('b', 2, true), P('c', 3)],
      scores: { a: 5, b: 6, c: 2 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'CONTINUE' })
  })

  test('E8 at the end of the deck: only out players at 5 exhausts rather than wins', () => {
    const outcome = resolveOutcome({
      players: [P('a', 1, true), P('b', 2)],
      scores: { a: 5, b: 4 },
      callSequence: TOTAL_NUMBERS,
    })
    expect(outcome).toEqual({ kind: 'EXHAUSTED' })
  })
})

describe('resolveOutcome — running out of numbers', () => {
  test('E10: all 25 called with nobody at 5 is an exhaustion, not a draw', () => {
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: 4, b: 4 },
      callSequence: TOTAL_NUMBERS,
    })
    // Distinct from DRAW on purpose: nobody achieved anything here.
    expect(outcome).toEqual({ kind: 'EXHAUSTED' })
  })

  test('E11: a 25th call that puts two players at 5 is a draw, not an exhaustion', () => {
    const outcome = resolveOutcome({
      players: TWO,
      scores: { a: 5, b: 5 },
      callSequence: TOTAL_NUMBERS,
    })
    expect(outcome).toEqual({ kind: 'DRAW', coWinnerIds: ['a', 'b'] })
  })

  test('the game continues while numbers remain and nobody has 5', () => {
    const outcome = resolveOutcome({
      players: FOUR,
      scores: { a: 4, b: 3, c: 0, d: 4 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'CONTINUE' })
  })
})

describe('resolveOutcome — purity', () => {
  test('E12: replaying the same call yields an identical result', () => {
    const args = {
      players: FOUR,
      scores: { a: 5, b: 5, c: 1, d: 0 },
      callSequence: MID,
    }
    expect(resolveOutcome(args)).toEqual(resolveOutcome(args))
  })

  test('does not mutate the players array it was handed', () => {
    // It sorts by turn order internally; doing that in place would quietly
    // reorder the caller's own list — which on the server is the row set used
    // moments later to advance the turn.
    const players = [P('d', 4), P('a', 1), P('c', 3), P('b', 2)]
    const before = players.map((p) => p.playerId)
    resolveOutcome({ players, scores: { a: 5, b: 5 }, callSequence: MID })
    expect(players.map((p) => p.playerId)).toEqual(before)
  })

  test('a missing score entry counts as zero rather than crashing', () => {
    const outcome = resolveOutcome({
      players: FOUR,
      scores: { a: 5 },
      callSequence: MID,
    })
    expect(outcome).toEqual({ kind: 'WINNER', winnerId: 'a' })
  })
})
