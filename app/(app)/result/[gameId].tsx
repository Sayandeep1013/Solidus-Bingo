/**
 * app/(app)/result/[gameId].tsx — ResultScreen
 *
 * Shows win/loss/draw result and Play Again / Leave buttons.
 * Draw (ABANDONED) → "No Winner — Draw"
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useGameStore } from '@/store/gameStore'
import { useRoomStore } from '@/store/roomStore'
import { resetGameStore } from '@/store'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'

export default function ResultScreen() {
  const { userId } = useAuth()
  const winnerId = useGameStore((s) => s.winnerId)
  const gameStatus = useGameStore((s) => s.gameStatus)
  const winningCall = useGameStore((s) => s.winningCall)
  const scoreMap = useGameStore((s) => s.scoreMap)
  const gameNumber = useGameStore((s) => s.gameNumber)
  const roomId = useRoomStore((s) => s.roomId)

  const isWinner = winnerId === userId
  const isDraw = gameStatus === 'ABANDONED'

  const handlePlayAgain = async () => {
    if (!roomId || !gameNumber) return
    await invokeEdgeFunction('submit-rematch-vote', {
      body: { room_id: roomId, game_number: gameNumber },
    })
    resetGameStore()
    router.replace(`/(app)/lobby/${roomId}`)
  }

  const handleLeave = async () => {
    if (roomId) {
      await invokeEdgeFunction('leave-room', { body: { room_id: roomId } })
    }
    resetGameStore()
    router.replace('/(app)')
  }

  return (
    <View style={styles.container}>
      <View style={styles.resultCard}>
        {isDraw ? (
          <>
            <Text style={styles.drawEmoji}>🤝</Text>
            <Text style={styles.resultTitle}>No Winner</Text>
            <Text style={styles.resultSubtitle}>It&apos;s a draw — all 25 numbers called!</Text>
          </>
        ) : isWinner ? (
          <>
            <Text style={styles.winEmoji}>🏆</Text>
            <Text style={styles.resultTitle}>You Win!</Text>
            <Text style={styles.resultSubtitle}>
              Winning call: {winningCall}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.loseEmoji}>😔</Text>
            <Text style={styles.resultTitle}>You Lost</Text>
            <Text style={styles.resultSubtitle}>
              Better luck next time!
            </Text>
          </>
        )}
      </View>

      {/* Final scores */}
      <View style={styles.scoresContainer}>
        <Text style={styles.scoresTitle}>Final Scores</Text>
        {Object.entries(scoreMap).map(([pId, score]) => (
          <View key={pId} style={styles.scoreRow}>
            <Text style={styles.scoreLabel}>
              {pId === userId ? 'You' : 'Opponent'}
              {pId === winnerId ? ' 🏆' : ''}
            </Text>
            <Text style={styles.scoreValue}>{score} lines</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.playAgainButton}
          onPress={handlePlayAgain}
          accessibilityRole="button"
          accessibilityLabel="Play again"
        >
          <Text style={styles.playAgainText}>Play Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.leaveButton}
          onPress={handleLeave}
          accessibilityRole="button"
          accessibilityLabel="Leave"
        >
          <Text style={styles.leaveText}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#1a1a2e',
    paddingHorizontal: 24, justifyContent: 'center', gap: 24,
  },
  resultCard: {
    backgroundColor: '#2a2a40', borderRadius: 16, padding: 32,
    alignItems: 'center', gap: 8,
  },
  winEmoji: { fontSize: 56 },
  loseEmoji: { fontSize: 56 },
  drawEmoji: { fontSize: 56 },
  resultTitle: { fontSize: 32, fontWeight: 'bold', color: '#ffffff' },
  resultSubtitle: { fontSize: 15, color: '#aaaaaa', textAlign: 'center' },
  scoresContainer: { gap: 8 },
  scoresTitle: { color: '#888888', fontSize: 13, textTransform: 'uppercase' },
  scoreRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#2a2a40', borderRadius: 8, padding: 12,
  },
  scoreLabel: { color: '#ffffff', fontSize: 15 },
  scoreValue: { color: '#6c63ff', fontSize: 15, fontWeight: '700' },
  actions: { gap: 10 },
  playAgainButton: {
    backgroundColor: '#6c63ff', borderRadius: 10, paddingVertical: 16, alignItems: 'center',
  },
  playAgainText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  leaveButton: {
    backgroundColor: '#2a2a40', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  leaveText: { color: '#cc4444', fontSize: 16 },
})
