/**
 * app/(app)/lobby/[roomId].tsx — LobbyScreen
 *
 * Shows player slots, room code, host crown, and Start Game button.
 * Subscribes to Realtime channel on mount.
 *
 * Spec: bingo-room-lobby
 * - Start Game: only host, only when FULL, only when CONNECTED
 * - Presence leave → show disconnected indicator (not empty slot)
 * - Retain channel subscription across lobby → game transition
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useRoomStore, selectCanStartGame } from '@/store/roomStore'
import { useConnectionStore, selectIsConnected } from '@/store/connectionStore'
import { useGameStore } from '@/store/gameStore'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import type { RoomPlayer } from '@/types/game'

export default function LobbyScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  const { userId } = useAuth()

  const roomCode = useRoomStore((s) => s.roomCode)
  const capacity = useRoomStore((s) => s.capacity)
  const roomStatus = useRoomStore((s) => s.roomStatus)
  const players = useRoomStore((s) => s.players)
  const rematchVoteCount = useRoomStore((s) => s.rematchVoteCount)
  const isConnected = useConnectionStore(selectIsConnected)
  const gameStatus = useGameStore((s) => s.gameStatus)
  const gameId = useGameStore((s) => s.gameId)
  const gameNumber = useGameStore((s) => s.gameNumber)

  const canStart = useRoomStore(selectCanStartGame(userId, isConnected))

  const [isStarting, setIsStarting] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  // Realtime channel is owned by app/(app)/_layout.tsx so it survives the
  // lobby → game navigation instead of being torn down on unmount.

  // Navigate to game when it starts
  useEffect(() => {
    if (gameStatus === 'ACTIVE' && gameId) {
      router.replace(`/(app)/game/${gameId}`)
    }
  }, [gameStatus, gameId])

  const handleStartGame = async () => {
    setIsStarting(true)
    setStartError(null)
    try {
      const { data, error } = await invokeEdgeFunction('start-game', {
        body: { room_id: roomId },
      })
      if (error || !data?.ok) {
        setStartError(data?.error?.message ?? 'Failed to start game')
      }
      // Navigation happens via Realtime game status update
    } catch {
      setStartError('Network error')
    } finally {
      setIsStarting(false)
    }
  }

  const handleLeaveRoom = async () => {
    setIsLeaving(true)
    try {
      await invokeEdgeFunction('leave-room', { body: { room_id: roomId } })
      router.replace('/(app)')
    } catch {
      // Leave anyway
      router.replace('/(app)')
    } finally {
      setIsLeaving(false)
    }
  }

  const handleRematchVote = async () => {
    if (!gameNumber) return
    await invokeEdgeFunction('submit-rematch-vote', {
      body: { room_id: roomId, game_number: gameNumber },
    })
  }

  return (
    <View style={styles.container}>
      {/* Connection banner */}
      {!isConnected && (
        <View style={styles.reconnectingBanner}>
          <ActivityIndicator color="#ffffff" size="small" />
          <Text style={styles.reconnectingText}>Reconnecting…</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.roomCode}>Room: {roomCode ?? '------'}</Text>
        <Text style={styles.statusText}>{roomStatus}</Text>
      </View>

      {/* Player slots */}
      <ScrollView style={styles.playersContainer} contentContainerStyle={styles.playersContent}>
        {Array.from({ length: capacity ?? 4 }).map((_, i) => {
          const player = players[i]
          return <PlayerSlot key={i} player={player} isMe={player?.playerId === userId} />
        })}
      </ScrollView>

      {startError ? (
        <Text style={styles.errorText}>{startError}</Text>
      ) : null}

      {/* Rematch waiting state */}
      {roomStatus === 'REMATCH_WAITING' && (
        <View style={styles.rematchContainer}>
          <Text style={styles.rematchText}>
            Rematch votes: {rematchVoteCount} / {players.filter(p => p.isOnline).length}
          </Text>
          <TouchableOpacity style={styles.rematchButton} onPress={handleRematchVote}>
            <Text style={styles.rematchButtonText}>Play Again</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.footer}>
        {/* Start Game — only visible and enabled for host when room is FULL + CONNECTED */}
        {canStart && roomStatus === 'FULL' && (
          <TouchableOpacity
            style={[styles.startButton, isStarting && styles.disabled]}
            onPress={handleStartGame}
            disabled={isStarting}
            accessibilityRole="button"
            accessibilityLabel="Start game"
          >
            {isStarting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.startButtonText}>Start Game</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.leaveButton, isLeaving && styles.disabled]}
          onPress={handleLeaveRoom}
          disabled={isLeaving}
          accessibilityRole="button"
          accessibilityLabel="Leave room"
        >
          <Text style={styles.leaveButtonText}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── PlayerSlot component ──────────────────────────────────────────────────────

function PlayerSlot({ player, isMe }: { player?: RoomPlayer; isMe: boolean }) {
  if (!player) {
    return (
      <View style={[styles.slot, styles.slotEmpty]}>
        <Text style={styles.slotEmptyText}>Waiting…</Text>
      </View>
    )
  }

  return (
    <View style={[styles.slot, !player.isOnline && styles.slotDisconnected]}>
      <View style={styles.slotLeft}>
        <Text style={styles.slotUsername}>
          {player.username ?? 'Loading…'}
          {isMe ? ' (you)' : ''}
        </Text>
        {!player.isOnline && (
          <Text style={styles.disconnectedLabel}>disconnected</Text>
        )}
      </View>
      <View style={styles.slotRight}>
        {player.joinOrder === 1 && (
          <Text style={styles.hostCrown}>👑</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  reconnectingBanner: {
    backgroundColor: '#2a1a3a', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingVertical: 8,
  },
  reconnectingText: { color: '#cc99ff', fontSize: 13 },
  header: { padding: 24, gap: 4 },
  roomCode: { fontSize: 22, fontWeight: 'bold', color: '#ffffff' },
  statusText: { fontSize: 13, color: '#888888', textTransform: 'uppercase' },
  playersContainer: { flex: 1 },
  playersContent: { paddingHorizontal: 24, gap: 10, paddingBottom: 16 },
  slot: {
    backgroundColor: '#2a2a40', borderRadius: 10, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  slotEmpty: { borderStyle: 'dashed', opacity: 0.5 },
  slotEmptyText: { fontSize: 14, color: '#666666', fontStyle: 'italic' },
  slotDisconnected: { borderColor: '#664444', opacity: 0.7 },
  slotLeft: { gap: 2 },
  slotRight: {},
  slotUsername: { fontSize: 16, color: '#ffffff', fontWeight: '600' },
  disconnectedLabel: { fontSize: 11, color: '#aa4444' },
  hostCrown: { fontSize: 20 },
  rematchContainer: { paddingHorizontal: 24, gap: 12, paddingVertical: 12 },
  rematchText: { color: '#aaaaaa', textAlign: 'center' },
  rematchButton: {
    backgroundColor: '#6c63ff', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
  },
  rematchButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  footer: { padding: 24, gap: 10 },
  startButton: {
    backgroundColor: '#00cc88', borderRadius: 10, paddingVertical: 16, alignItems: 'center',
  },
  startButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  leaveButton: {
    backgroundColor: '#2a2a40', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  leaveButtonText: { color: '#cc4444', fontSize: 16 },
  disabled: { opacity: 0.5 },
  errorText: { color: '#ff6b6b', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
})
