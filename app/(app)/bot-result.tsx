/**
 * app/(app)/bot-result.tsx — BotResultScreen
 *
 * Win/loss/draw for a Bot_Session. "Play Again" starts a brand-new session
 * with the same player count — no rematch-vote flow, since there are no
 * other humans to vote (spec bingo-play-vs-bot Req 3.3).
 */
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useBotGameStore, HUMAN_PLAYER_ID } from '@/store/botGameStore'
import { colors, fonts, spacing, KICKER_LETTER_SPACING } from '@/theme'
import { PaperBackground, NewsButton, NewsCard, Divider } from '@/components/news'

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
    <PaperBackground>
      <View style={styles.container}>
        <NewsCard style={styles.resultCard}>
          {isDraw ? (
            <>
              <MaterialCommunityIcons name="handshake-outline" size={52} color={colors.inkFaded} />
              <Text style={styles.kicker}>Practice Edition</Text>
              <Text style={styles.resultTitle}>No Winner</Text>
              <Text style={styles.resultSubtitle}>It&apos;s a draw — all 25 numbers called!</Text>
            </>
          ) : isWinner ? (
            <>
              <Ionicons name="trophy" size={52} color={colors.accent} />
              <Text style={styles.kicker}>Practice Edition</Text>
              <Text style={styles.resultTitle}>You Win!</Text>
              <Text style={styles.resultSubtitle}>Winning call: {winningCall}</Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="robot-outline" size={52} color={colors.inkFaded} />
              <Text style={styles.kicker}>Practice Edition</Text>
              <Text style={styles.resultTitle}>{winnerName ?? 'Bot'} Wins</Text>
              <Text style={styles.resultSubtitle}>Better luck next time!</Text>
            </>
          )}
        </NewsCard>

        <View style={styles.scoresContainer}>
          <Text style={styles.scoresTitle}>Final Scores</Text>
          <Divider />
          {players.map((p, i) => (
            <View key={p.playerId}>
              {i > 0 ? <Divider style={styles.rowRule} /> : null}
              <View style={styles.scoreRow}>
                <View style={styles.scoreLabelRow}>
                  <Text style={styles.scoreLabel}>{p.displayName}</Text>
                  {p.playerId === winnerId ? <Ionicons name="trophy" size={14} color={colors.accent} /> : null}
                </View>
                <Text style={styles.scoreValue}>{scoreMap[p.playerId] ?? 0} lines</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <NewsButton label="Play Again" onPress={handlePlayAgain} variant="accent" accessibilityLabel="Play again" />
          <NewsButton label="Back to Home" onPress={handleBackHome} variant="plain" accessibilityLabel="Back to home" />
        </View>
      </View>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24, justifyContent: 'center', gap: spacing.lg,
  },
  resultCard: {
    alignItems: 'center', gap: 6, paddingVertical: 32,
  },
  kicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded, marginTop: spacing.sm,
  },
  resultTitle: { fontFamily: fonts.headlineBlack, fontSize: 32, color: colors.ink },
  resultSubtitle: { fontFamily: fonts.bodyItalic, fontSize: 15, color: colors.inkFaded, textAlign: 'center' },
  scoresContainer: { gap: spacing.xs },
  scoresTitle: {
    fontFamily: fonts.bodyBold, color: colors.inkFaded, fontSize: 12,
    letterSpacing: KICKER_LETTER_SPACING,
  },
  rowRule: { marginVertical: 2 },
  scoreRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
  },
  scoreLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreLabel: { fontFamily: fonts.body, color: colors.ink, fontSize: 15 },
  scoreValue: { fontFamily: fonts.bodyBold, color: colors.accent, fontSize: 15 },
  actions: { gap: spacing.sm },
})
