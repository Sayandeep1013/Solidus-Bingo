/**
 * app/(app)/bot-result.tsx — BotResultScreen
 *
 * Win/loss/draw for a Bot_Session. "Play Again" starts a brand-new session
 * with the same player count — no rematch-vote flow, since there are no
 * other humans to vote (spec bingo-play-vs-bot Req 3.3).
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useBotGameStore, HUMAN_PLAYER_ID } from '@/store/botGameStore'

export default function BotResultScreen() {
  const winnerId = useBotGameStore((s) => s.winnerId)
  const status = useBotGameStore((s) => s.status)
  const winningCall = useBotGameStore((s) => s.winningCall)
  const scoreMap = useBotGameStore((s) => s.scoreMap)
  const players = useBotGameStore((s) => s.players)
  const startSession = useBotGameStore((s) => s.startSession)
  const reset = useBotGameStore((s) => s.reset)

  const isWinner = winnerId === HUMAN_PLAYER_ID
  const isDraw = status === 'ABANDONED'
  const winnerName = players.find((p) => p.playerId === winnerId)?.displayName

  const handlePlayAgain = () => {
    startSession(players.length as 2 | 3 | 4)
    router.replace('/(app)/bot-game')
  }

  const handleBackHome = () => {
    reset()
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
            <Text style={styles.resultSubtitle}>Winning call: {winningCall}</Text>
          </>
        ) : (
          <>
            <Text style={styles.loseEmoji}>🤖</Text>
            <Text style={styles.resultTitle}>{winnerName ?? 'Bot'} Wins</Text>
            <Text style={styles.resultSubtitle}>Better luck next time!</Text>
          </>
        )}
      </View>

      <View style={styles.scoresContainer}>
        <Text style={styles.scoresTitle}>Final Scores</Text>
        {players.map((p) => (
          <View key={p.playerId} style={styles.scoreRow}>
            <Text style={styles.scoreLabel}>
              {p.displayName}
              {p.playerId === winnerId ? ' 🏆' : ''}
            </Text>
            <Text style={styles.scoreValue}>{scoreMap[p.playerId] ?? 0} lines</Text>
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
          onPress={handleBackHome}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={styles.leaveText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, justifyContent: 'center', gap: 24 },
  resultCard: { backgroundColor: '#2a2a40', borderRadius: 16, padding: 32, alignItems: 'center', gap: 8 },
  winEmoji: { fontSize: 56 },
  loseEmoji: { fontSize: 56 },
  drawEmoji: { fontSize: 56 },
  resultTitle: { fontSize: 32, fontWeight: 'bold', color: '#ffffff' },
  resultSubtitle: { fontSize: 15, color: '#aaaaaa', textAlign: 'center' },
  scoresContainer: { gap: 8 },
  scoresTitle: { color: '#888888', fontSize: 13, textTransform: 'uppercase' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#2a2a40', borderRadius: 8, padding: 12 },
  scoreLabel: { color: '#ffffff', fontSize: 15 },
  scoreValue: { color: '#6c63ff', fontSize: 15, fontWeight: '700' },
  actions: { gap: 10 },
  playAgainButton: { backgroundColor: '#6c63ff', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  playAgainText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  leaveButton: { backgroundColor: '#2a2a40', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3a3a55' },
  leaveText: { color: '#cc4444', fontSize: 16 },
})
