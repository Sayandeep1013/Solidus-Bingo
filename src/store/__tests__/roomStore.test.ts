/**
 * Zustand Room Store Unit Tests
 * Spec: bingo-testing Req 5.6–5.9
 */
import { useRoomStore } from '../roomStore'

beforeEach(() => {
  useRoomStore.getState().reset()
})

// Req 5.6 — setRoom populates all fields
test('setRoom populates all fields correctly', () => {
  useRoomStore.getState().setRoom({
    roomId: 'room-1',
    roomCode: 'ABC123',
    capacity: 3,
    roomStatus: 'WAITING',
    hostId: 'player-1',
    players: [{ playerId: 'player-1', username: 'Alice', joinOrder: 1, isOnline: true }],
  })

  const s = useRoomStore.getState()
  expect(s.roomId).toBe('room-1')
  expect(s.roomCode).toBe('ABC123')
  expect(s.capacity).toBe(3)
  expect(s.roomStatus).toBe('WAITING')
  expect(s.hostId).toBe('player-1')
  expect(s.players).toHaveLength(1)
})

// Req 5.7 — playerJoined adds player without duplicates
test('upsertPlayer adds new player and deduplicates existing', () => {
  useRoomStore.getState().setRoom({
    roomId: 'room-1', roomCode: 'X', capacity: 2,
    roomStatus: 'WAITING', hostId: 'p1', players: [],
  })

  useRoomStore.getState().upsertPlayer({ playerId: 'p2', username: 'Bob', joinOrder: 2, isOnline: true })
  useRoomStore.getState().upsertPlayer({ playerId: 'p2', username: 'Bob', joinOrder: 2, isOnline: true })

  expect(useRoomStore.getState().players.filter((p) => p.playerId === 'p2')).toHaveLength(1)
})

// Req 5.8 — playerLeft marks isOnline false (slot preserved)
test('updatePlayer marks player as offline without removing slot', () => {
  useRoomStore.getState().setRoom({
    roomId: 'room-1', roomCode: 'X', capacity: 2,
    roomStatus: 'FULL', hostId: 'p1',
    players: [
      { playerId: 'p1', username: 'Alice', joinOrder: 1, isOnline: true },
      { playerId: 'p2', username: 'Bob', joinOrder: 2, isOnline: true },
    ],
  })

  useRoomStore.getState().updatePlayer('p2', { isOnline: false })

  const players = useRoomStore.getState().players
  expect(players).toHaveLength(2)
  expect(players.find((p) => p.playerId === 'p2')?.isOnline).toBe(false)
})

// Req 5.9 — hostTransferred updates hostId
test('updateHostId updates the hostId correctly', () => {
  useRoomStore.getState().setRoom({
    roomId: 'room-1', roomCode: 'X', capacity: 2,
    roomStatus: 'WAITING', hostId: 'p1', players: [],
  })

  useRoomStore.getState().updateHostId('p2')
  expect(useRoomStore.getState().hostId).toBe('p2')
})

// Room status update
test('updateRoomStatus changes roomStatus', () => {
  useRoomStore.getState().setRoom({
    roomId: 'r1', roomCode: 'X', capacity: 2,
    roomStatus: 'WAITING', hostId: 'p1', players: [],
  })

  useRoomStore.getState().updateRoomStatus('FULL')
  expect(useRoomStore.getState().roomStatus).toBe('FULL')
})

// rematch vote count
test('incrementRematchVoteCount increments by 1', () => {
  useRoomStore.getState().setRoom({
    roomId: 'r1', roomCode: 'X', capacity: 2,
    roomStatus: 'GAME_FINISHED', hostId: 'p1', players: [],
  })

  useRoomStore.getState().incrementRematchVoteCount()
  useRoomStore.getState().incrementRematchVoteCount()
  expect(useRoomStore.getState().rematchVoteCount).toBe(2)
})
