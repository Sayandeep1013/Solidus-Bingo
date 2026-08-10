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
import { ActivityIndicator, ScrollView, Text, View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useRoomStore, selectCanStartGame } from '@/store/roomStore'
import { useConnectionStore, selectIsConnected } from '@/store/connectionStore'
import { useGameStore } from '@/store/gameStore'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import type { RoomPlayer } from '@/types/game'
import { colors, fonts, spacing, radius, KICKER_LETTER_SPACING } from '@/theme'
import { PaperBackground, NewsButton, NewsCard, Divider } from '@/components/news'

export default function LobbyScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  const { userId } = useAuth()
  const insets = useSafeAreaInsets()

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
    <PaperBackground>
      <View style={styles.container}>
        {/* Connection banner */}
        {!isConnected && (
          <View style={styles.reconnectingBanner}>
            <ActivityIndicator color={colors.paper} size="small" />
            <Text style={styles.reconnectingText}>Reconnecting…</Text>
          </View>
        )}

        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.kicker}>Room Notice</Text>
          <Text style={styles.roomCode}>{roomCode ?? '------'}</Text>
          <Text style={styles.statusText}>{roomStatus}</Text>
          <Divider style={styles.headerRule} />
        </View>

        {/* Player slots */}
        <ScrollView style={styles.playersContainer} contentContainerStyle={styles.playersContent}>
          {Array.from({ length: capacity ?? 4 }).map((_, i) => {
            const player = players[i]
            return <PlayerSlot key={i} player={player} isMe={player?.playerId === userId} />
          })}
        </ScrollView>

        {startError ? <Text style={styles.errorText}>{startError}</Text> : null}

        {/* Rematch waiting state */}
        {roomStatus === 'REMATCH_WAITING' && (
          <View style={styles.rematchContainer}>
            <Text style={styles.rematchText}>
              Rematch votes: {rematchVoteCount} / {players.filter((p) => p.isOnline).length}
            </Text>
            <NewsButton label="Play Again" onPress={handleRematchVote} variant="accent" />
          </View>
        )}

        <View style={styles.footer}>
          {/* Start Game — only visible and enabled for host when room is FULL + CONNECTED */}
          {canStart && roomStatus === 'FULL' && (
            <NewsButton
              label="Start Game"
              onPress={handleStartGame}
              variant="accent"
              loading={isStarting}
              accessibilityLabel="Start game"
            />
          )}

          <NewsButton
            label="Leave"
            onPress={handleLeaveRoom}
            variant="plain"
            loading={isLeaving}
            accessibilityLabel="Leave room"
          />
        </View>
      </View>
    </PaperBackground>
  )
}

// ── PlayerSlot component ──────────────────────────────────────────────────────

function PlayerSlot({ player, isMe }: { player?: RoomPlayer; isMe: boolean }) {
  if (!player) {
    return (
      <NewsCard style={styles.slotEmpty}>
        <Text style={styles.slotEmptyText}>Awaiting Player…</Text>
      </NewsCard>
    )
  }

  return (
    <NewsCard muted={!player.isOnline} style={styles.slot}>
      <View style={styles.slotLeft}>
        <Text style={styles.slotUsername}>
          {player.username ?? 'Loading…'}
          {isMe ? ' (you)' : ''}
        </Text>
        {!player.isOnline && (
          <View style={styles.disconnectedRow}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.accent} />
            <Text style={styles.disconnectedLabel}>disconnected</Text>
          </View>
        )}
      </View>
      {player.joinOrder === 1 && (
        <MaterialCommunityIcons name="crown-outline" size={20} color={colors.accent} />
      )}
    </NewsCard>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  reconnectingBanner: {
    backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing.xs, paddingVertical: 8,
  },
  reconnectingText: { fontFamily: fonts.bodyBold, color: colors.paper, fontSize: 13 },
  header: { paddingHorizontal: 24, paddingBottom: spacing.sm, gap: 2 },
  kicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded,
  },
  roomCode: { fontFamily: fonts.headlineBlack, fontSize: 32, color: colors.ink, letterSpacing: 2 },
  statusText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent, textTransform: 'uppercase', letterSpacing: 1 },
  headerRule: { marginTop: spacing.sm },
  playersContainer: { flex: 1 },
  playersContent: { paddingHorizontal: 24, gap: spacing.sm, paddingBottom: 16, paddingTop: spacing.sm },
  slot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  slotEmpty: { borderStyle: 'dashed', opacity: 0.6, alignItems: 'center' },
  slotEmptyText: { fontFamily: fonts.bodyItalic, fontSize: 14, color: colors.inkFaded },
  slotLeft: { gap: 2 },
  slotUsername: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  disconnectedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  disconnectedLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.accent },
  rematchContainer: { paddingHorizontal: 24, gap: spacing.sm, paddingVertical: spacing.sm },
  rematchText: { fontFamily: fonts.body, color: colors.inkFaded, textAlign: 'center' },
  footer: { padding: 24, gap: spacing.sm, borderRadius: radius.none },
  errorText: { fontFamily: fonts.body, color: colors.accent, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
})
