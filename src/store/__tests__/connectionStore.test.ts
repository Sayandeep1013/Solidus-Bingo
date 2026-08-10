/**
 * Zustand Connection Store Unit Tests
 * Spec: bingo-testing Req 5.10, 5.11
 */
import { useConnectionStore } from '../connectionStore'

beforeEach(() => {
  useConnectionStore.getState().reset()
})

// Req 5.10 — CONNECTED → RECONNECTING → CONNECTED cycle
test('correctly transitions CONNECTED → RECONNECTING → CONNECTED', () => {
  expect(useConnectionStore.getState().connectionState).toBe('CONNECTED')

  useConnectionStore.getState().setReconnecting()
  expect(useConnectionStore.getState().connectionState).toBe('RECONNECTING')

  useConnectionStore.getState().setConnected()
  expect(useConnectionStore.getState().connectionState).toBe('CONNECTED')
  expect(useConnectionStore.getState().reconnectAttempts).toBe(0)
  expect(useConnectionStore.getState().snapshotError).toBeNull()
})

test('setDisconnected transitions to DISCONNECTED', () => {
  useConnectionStore.getState().setReconnecting()
  useConnectionStore.getState().setDisconnected()
  expect(useConnectionStore.getState().connectionState).toBe('DISCONNECTED')
})

test('incrementReconnectAttempts increments correctly', () => {
  useConnectionStore.getState().setReconnecting()
  useConnectionStore.getState().incrementReconnectAttempts()
  useConnectionStore.getState().incrementReconnectAttempts()
  expect(useConnectionStore.getState().reconnectAttempts).toBe(2)
})

test('setSnapshotError stores error and clears on setConnected', () => {
  useConnectionStore.getState().setSnapshotError('Failed to load snapshot')
  expect(useConnectionStore.getState().snapshotError).toBe('Failed to load snapshot')

  useConnectionStore.getState().setConnected()
  expect(useConnectionStore.getState().snapshotError).toBeNull()
})

test('setReconnecting when already RECONNECTING does not reset lastTransitionAt', () => {
  useConnectionStore.getState().setReconnecting()
  const first = useConnectionStore.getState().lastTransitionAt

  useConnectionStore.getState().setReconnecting()
  const second = useConnectionStore.getState().lastTransitionAt

  expect(first).toBe(second)
})

test('reset returns to initial CONNECTED state', () => {
  useConnectionStore.getState().setDisconnected()
  useConnectionStore.getState().setSnapshotError('err')
  useConnectionStore.getState().reset()

  const s = useConnectionStore.getState()
  expect(s.connectionState).toBe('CONNECTED')
  expect(s.snapshotError).toBeNull()
  expect(s.reconnectAttempts).toBe(0)
})
