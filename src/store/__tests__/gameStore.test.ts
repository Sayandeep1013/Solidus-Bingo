/**
 * Zustand Game Store Unit Tests
 * Spec: bingo-testing Req 5.1–5.5, 5.12
 */
import { useGameStore } from '../gameStore'

// Reset store before each test to avoid state bleed
beforeEach(() => {
  useGameStore.getState().reset()
})

// Req 5.1 — initial state
test('initial state has all null/empty values', () => {
  const state = useGameStore.getState()
  expect(state.gameId).toBeNull()
  expect(state.gameStatus).toBeNull()
  expect(state.activePlayerId).toBeNull()
  expect(state.calledNumbers).toEqual([])
  expect(state.scoreMap).toEqual({})
  expect(state.completedLines).toEqual([])
})

// Req 5.2 — setGameActive
test('setGameActive populates all game fields', () => {
  useGameStore.getState().setGameActive({
    gameId: 'game-1',
    myBoard: Array.from({ length: 25 }, (_, i) => i + 1),
    activePlayerId: 'p1',
    initialScores: { p1: 0, p2: 0 },
  })
  const state = useGameStore.getState()
  expect(state.gameId).toBe('game-1')
  expect(state.gameStatus).toBe('ACTIVE')
  expect(state.activePlayerId).toBe('p1')
  expect(state.scoreMap).toEqual({ p1: 0, p2: 0 })
  expect(state.myBoard).toHaveLength(25)
})

// Req 5.3 — applyCall adds number, updates activePlayerId and scores
test('applyCall adds number, updates activePlayerId, merges completed lines and scores', () => {
  useGameStore.getState().setGameActive({
    gameId: 'game-1',
    myBoard: Array.from({ length: 25 }, (_, i) => i + 1),
    activePlayerId: 'p1',
    initialScores: { p1: 0, p2: 0 },
  })

  useGameStore.getState().applyCall({
    number: 5,
    sequence: 1,
    newActivePlayerId: 'p2',
    newlyCompletedLines: [{ playerId: 'p1', lineId: 'row_0', completingCallSequence: 1 }],
    updatedScores: { p1: 1, p2: 0 },
  })

  const state = useGameStore.getState()
  expect(state.calledNumbers).toContain(5)
  expect(state.activePlayerId).toBe('p2')
  expect(state.scoreMap.p1).toBe(1)
  expect(state.completedLines).toHaveLength(1)
  expect(state.completedLines[0].lineId).toBe('row_0')
  expect(state.lastCallSequence).toBe(1)
})

// Req 5.4 — applyCall is idempotent (duplicate number not added)
test('applyCall with duplicate number does not add it again', () => {
  useGameStore.getState().setGameActive({
    gameId: 'game-1',
    myBoard: Array.from({ length: 25 }, (_, i) => i + 1),
    activePlayerId: 'p1',
    initialScores: { p1: 0, p2: 0 },
  })

  useGameStore.getState().applyCall({
    number: 7,
    sequence: 1,
    newActivePlayerId: 'p2',
    newlyCompletedLines: [],
    updatedScores: {},
  })

  useGameStore.getState().applyCall({
    number: 7,  // duplicate
    sequence: 1,
    newActivePlayerId: 'p1',
    newlyCompletedLines: [],
    updatedScores: {},
  })

  const { calledNumbers } = useGameStore.getState()
  expect(calledNumbers.filter((n) => n === 7)).toHaveLength(1)
})

// Req 5.5 — setGameFinished sets correct status, winner, prevents further mutation
test('setGameFinished sets FINISHED status and winnerId', () => {
  useGameStore.getState().setGameActive({
    gameId: 'game-1',
    myBoard: Array.from({ length: 25 }, (_, i) => i + 1),
    activePlayerId: 'p1',
    initialScores: { p1: 5, p2: 2 },
  })

  useGameStore.getState().setGameFinished({
    winnerId: 'p1',
    winningCall: 13,
    finalScores: { p1: 5, p2: 2 },
  })

  const state = useGameStore.getState()
  expect(state.gameStatus).toBe('FINISHED')
  expect(state.winnerId).toBe('p1')
  expect(state.winningCall).toBe(13)
  expect(state.activePlayerId).toBeNull()
})

// Req 5.12 — reset returns store to initial state
test('reset returns store to initial state', () => {
  useGameStore.getState().setGameActive({
    gameId: 'game-1',
    myBoard: Array.from({ length: 25 }, (_, i) => i + 1),
    activePlayerId: 'p1',
    initialScores: { p1: 3 },
  })

  useGameStore.getState().reset()

  const state = useGameStore.getState()
  expect(state.gameId).toBeNull()
  expect(state.gameStatus).toBeNull()
  expect(state.calledNumbers).toEqual([])
  expect(state.scoreMap).toEqual({})
})
