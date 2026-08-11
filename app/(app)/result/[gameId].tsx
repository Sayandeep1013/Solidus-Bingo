/**
 * app/(app)/result/[gameId].tsx — ResultScreen
 *
 * Shows win/loss/draw result and Play Again / Leave buttons.
 * Draw (ABANDONED) → "No Winner — Draw"
 */
import { useEffect } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useGameStore } from '@/store/gameStore'
import { useRoomStore } from '@/store/roomStore'
import { resetGameStore } from '@/store'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { colors, fonts, spacing, KICKER_LETTER_SPACING } from '@/theme'
import { PaperBackground, NewsButton, NewsCard, Divider } from '@/components/news'

export default function ResultScreen() {
  const { userId } = useAuth()
  const winnerId = useGameStore((s) => s.winnerId)
  const coWinnerIds = useGameStore((s) => s.coWinnerIds)
  const outcome = useGameStore((s) => s.outcome)
  const gameStatus = useGameStore((s) => s.gameStatus)
  const winningCall = useGameStore((s) => s.winningCall)
  const scoreMap = useGameStore((s) => s.scoreMap)
  const gameNumber = useGameStore((s) => s.gameNumber)
  const roomId = useRoomStore((s) => s.roomId)

  const isWinner = winnerId === userId
  // Several players reached 5 on the same call — they share it.
  const isSharedWin = outcome === 'DRAW'
  const sharedWithYou = isSharedWin && coWinnerIds.includes(userId ?? '')
  // Nobody reached 5 at all. A different result, and it reads differently.
  const isExhausted = outcome === 'ABANDONED' || gameStatus === 'ABANDONED'
  /** A co-winner earned the trophy too — they just didn't win it alone. */
  const isVictor = (playerId: string) => playerId === winnerId || coWinnerIds.includes(playerId)

  // A player who's live and present when a game ends lands here directly via
  // the GameScreen FINISHED/ABANDONED redirect — they've already "seen" the
  // result, so it should never also surface as a "while you were away"
  // notification on Home. Without this, every game (even ones watched live)
  // would sit unacknowledged until dismissed from Home — spec
  // bingo-disconnect-recovery §3.8.3-3.8.4.
  useEffect(() => {
    if (roomId) {
      invokeEdgeFunction('acknowledge-result', { body: { room_id: roomId } })
    }
  }, [roomId])

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
    <PaperBackground>
      <View style={styles.container}>
        <NewsCard style={styles.resultCard}>
          {isExhausted ? (
            <>
              <MaterialCommunityIcons name="handshake-outline" size={52} color={colors.inkFaded} />
              <Text style={styles.kicker}>Final Edition</Text>
              <Text style={styles.resultTitle}>Stalemate</Text>
              <Text style={styles.resultSubtitle}>All 25 numbers called and nobody reached five.</Text>
            </>
          ) : isSharedWin ? (
            <>
              <MaterialCommunityIcons
                name="handshake-outline"
                size={52}
                color={sharedWithYou ? colors.accent : colors.inkFaded}
              />
              <Text style={styles.kicker}>Final Edition</Text>
              <Text style={styles.resultTitle}>
                {sharedWithYou ? 'Shared Victory!' : 'Draw'}
              </Text>
              <Text style={styles.resultSubtitle}>
                {sharedWithYou
                  ? `${coWinnerIds.length} players reached five on call ${winningCall} — the win is shared.`
                  : `${coWinnerIds.length} players reached five at once on call ${winningCall}.`}
              </Text>
            </>
          ) : isWinner ? (
            <>
              <Ionicons name="trophy" size={52} color={colors.accent} />
              <Text style={styles.kicker}>Final Edition</Text>
              <Text style={styles.resultTitle}>Victory!</Text>
              <Text style={styles.resultSubtitle}>Winning call: {winningCall}</Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="emoticon-sad-outline" size={52} color={colors.inkFaded} />
              <Text style={styles.kicker}>Final Edition</Text>
              <Text style={styles.resultTitle}>Defeat</Text>
              <Text style={styles.resultSubtitle}>Better luck next time!</Text>
            </>
          )}
        </NewsCard>

        {/* Final scores */}
        <View style={styles.scoresContainer}>
          <Text style={styles.scoresTitle}>Final Scores</Text>
          <Divider />
          {Object.entries(scoreMap).map(([pId, score], i) => (
            <View key={pId}>
              {i > 0 ? <Divider style={styles.rowRule} /> : null}
              <View style={styles.scoreRow}>
                <View style={styles.scoreLabelRow}>
                  <Text style={styles.scoreLabel}>{pId === userId ? 'You' : 'Opponent'}</Text>
                  {isVictor(pId) ? <Ionicons name="trophy" size={14} color={colors.accent} /> : null}
                </View>
                <Text style={styles.scoreValue}>{score} lines</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <NewsButton label="Play Again" onPress={handlePlayAgain} variant="accent" accessibilityLabel="Play again" />
          <NewsButton label="Leave" onPress={handleLeave} variant="plain" accessibilityLabel="Leave" />
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
  resultTitle: { fontFamily: fonts.display, fontSize: 36, color: colors.ink },
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
