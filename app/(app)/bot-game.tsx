/**
 * app/(app)/bot-game.tsx — BotGameScreen
 *
 * Single-player practice mode against 1-3 local bots. No network, no
 * realtime channel, no Supabase writes — fully isolated from multiplayer
 * state (spec bingo-play-vs-bot Req 4).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useBotGameStore, HUMAN_PLAYER_ID, selectCutIndices } from '@/store/botGameStore'
import { colors, fonts, spacing, radius, KICKER_LETTER_SPACING } from '@/theme'
import { PaperBackground, Divider, NewsCard, BingoLineMark, BOARD_CELL, BOARD_GAP, BOARD_SIZE } from '@/components/news'

/** Bot "thinking" delay range in ms — spec bingo-play-vs-bot Req 2.1 */
const BOT_DELAY_MIN_MS = 900
const BOT_DELAY_MAX_MS = 2200

export default function BotGameScreen() {
  const players = useBotGameStore((s) => s.players)
  const boards = useBotGameStore((s) => s.boards)
  const calledNumbers = useBotGameStore((s) => s.calledNumbers)
  const scoreMap = useBotGameStore((s) => s.scoreMap)
  const activePlayerId = useBotGameStore((s) => s.activePlayerId)
  const status = useBotGameStore((s) => s.status)
  const completedLines = useBotGameStore((s) => s.completedLines)
  const callNumber = useBotGameStore((s) => s.callNumber)
  const reset = useBotGameStore((s) => s.reset)

  const [isBotThinking, setIsBotThinking] = useState(false)
  const botTurnHandledRef = useRef<string | null>(null)
  const insets = useSafeAreaInsets()

  const myBoard = boards[HUMAN_PLAYER_ID]
  const isMyTurn = status === 'ACTIVE' && activePlayerId === HUMAN_PLAYER_ID
  const cutIndices = selectCutIndices(myBoard, calledNumbers)
  const myScore = scoreMap[HUMAN_PLAYER_ID] ?? 0
  const activePlayer = players.find((p) => p.playerId === activePlayerId)
  const myCompletedLines = useMemo(
    () => completedLines.filter((l) => l.playerId === HUMAN_PLAYER_ID).map((l) => l.lineId),
    [completedLines]
  )

  // Bot turn — pick a random uncalled number after a short "thinking" delay.
  // botTurnHandledRef prevents re-firing for the same turn across unrelated
  // re-renders, and is cleared on every human turn so that a bot revisited
  // later in the rotation (3-4 player games) fires fresh each time.
  useEffect(() => {
    if (status !== 'ACTIVE' || !activePlayerId) return
    const seat = players.find((p) => p.playerId === activePlayerId)

    if (!seat?.isBot) {
      botTurnHandledRef.current = null
      return
    }

    if (botTurnHandledRef.current === activePlayerId) return
    botTurnHandledRef.current = activePlayerId

    setIsBotThinking(true)
    const delay = BOT_DELAY_MIN_MS + Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS)
    const timer = setTimeout(() => {
      const uncalled = Array.from({ length: 25 }, (_, i) => i + 1)
        .filter((n) => !calledNumbers.includes(n))
      if (uncalled.length > 0) {
        const pick = uncalled[Math.floor(Math.random() * uncalled.length)]
        callNumber(seat.playerId, pick)
      }
      setIsBotThinking(false)
    }, delay)

    return () => clearTimeout(timer)
  }, [activePlayerId, status, players, calledNumbers, callNumber])

  // Navigate to result when the session ends
  useEffect(() => {
    if (status === 'FINISHED' || status === 'ABANDONED') {
      router.replace('/(app)/bot-result')
    }
  }, [status])

  const handleCellTap = (cellIndex: number) => {
    if (!isMyTurn || !myBoard || cutIndices.has(cellIndex)) return
    const number = myBoard[cellIndex]
    callNumber(HUMAN_PLAYER_ID, number)
  }

  const handleLeave = () => {
    reset()
    router.replace('/(app)')
  }

  if (!myBoard) {
    return (
      <PaperBackground>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.ink} size="large" />
          <Text style={styles.loadingText}>Setting up…</Text>
        </View>
      </PaperBackground>
    )
  }

  return (
    <PaperBackground>
      <View style={styles.container}>
        <TouchableOpacity
          style={[styles.leaveTop, { paddingTop: insets.top + 12 }]}
          onPress={handleLeave}
          accessibilityRole="button"
          accessibilityLabel="Leave practice game"
        >
          <Ionicons name="chevron-back" size={16} color={colors.inkFaded} />
          <Text style={styles.leaveTopText}>Leave</Text>
        </TouchableOpacity>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Turn indicator */}
          <View style={styles.turnBanner}>
            <View style={[styles.turnDot, isMyTurn && styles.turnDotActive]} />
            <Text style={[styles.turnText, isMyTurn && styles.turnTextActive]}>
              {isMyTurn ? 'Your Turn' : `${activePlayer?.displayName ?? 'Opponent'}'s turn…`}
            </Text>
            {isBotThinking && <ActivityIndicator color={colors.accent} size="small" style={{ marginLeft: 8 }} />}
          </View>
          <Divider style={styles.turnRule} />

          {/* 5×5 Board */}
          <View style={styles.boardContainer}>
            <NewsCard style={styles.boardCard}>
              <View style={styles.board}>
                {myBoard.map((num, idx) => {
                  const isCut = cutIndices.has(idx)
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.cell, isCut && styles.cellCut, isMyTurn && !isCut && styles.cellCallable]}
                      onPress={() => handleCellTap(idx)}
                      disabled={!isMyTurn || isCut}
                      accessibilityRole="button"
                      accessibilityLabel={`Number ${num}${isCut ? ', called' : ''}`}
                      accessibilityState={{ disabled: !isMyTurn || isCut }}
                    >
                      {isCut ? (
                        <Ionicons name="checkmark" size={20} color={colors.success} style={styles.cutMark} />
                      ) : null}
                      <Text style={[styles.cellText, isCut && styles.cellTextCut]}>{num}</Text>
                    </TouchableOpacity>
                  )
                })}
                {myCompletedLines.map((lineId) => (
                  <BingoLineMark key={lineId} lineId={lineId} />
                ))}
              </View>
            </NewsCard>
          </View>

          {/* Scores */}
          <View style={styles.scoresContainer}>
            {players.map((p) => (
              <View key={p.playerId} style={[styles.scoreItem, p.playerId === HUMAN_PLAYER_ID && styles.myScoreItem]}>
                <Text style={styles.scoreName}>
                  {p.displayName}
                  {p.playerId === activePlayerId ? ' •' : ''}
                </Text>
                <Text style={styles.scoreValue}>{scoreMap[p.playerId] ?? 0}/5</Text>
              </View>
            ))}
          </View>

          <Text style={styles.myScore}>Your lines: {myScore} / 5</Text>

          <Divider style={styles.rule} />

          {/* Call history */}
          <View style={styles.callHistoryContainer}>
            <Text style={styles.callHistoryTitle}>Called ({calledNumbers.length}/25)</Text>
            <View style={styles.callHistoryGrid}>
              {[...calledNumbers].reverse().map((n, i) => (
                <View key={i} style={styles.calledChip}>
                  <Text style={styles.calledChipText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.footer}>
            <Divider thick />
            <Text style={styles.footerText}>Solidus Bingo — Practice Edition</Text>
          </View>
        </ScrollView>
      </View>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: spacing.xl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { fontFamily: fonts.bodyItalic, color: colors.inkFaded, fontSize: 14 },
  leaveTop: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingBottom: spacing.xs,
  },
  leaveTopText: { fontFamily: fonts.bodyBold, color: colors.inkFaded, fontSize: 14 },
  turnBanner: {
    paddingTop: spacing.md, paddingBottom: spacing.md,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.xs,
  },
  turnDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkFaint },
  turnDotActive: { backgroundColor: colors.accent },
  turnText: {
    fontFamily: fonts.headlineBold, fontSize: 18, color: colors.inkFaded,
  },
  turnTextActive: { fontFamily: fonts.headlineBlack, color: colors.accent },
  turnRule: { marginHorizontal: spacing.lg },
  boardContainer: { padding: spacing.lg, paddingTop: spacing.xl, alignItems: 'center' },
  boardCard: {
    padding: spacing.sm,
    borderWidth: 2,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  board: { width: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap', gap: BOARD_GAP },
  cell: {
    width: BOARD_CELL, height: BOARD_CELL, backgroundColor: colors.paperMuted,
    borderRadius: radius.hairline, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.rule,
  },
  cellCut: { backgroundColor: colors.paperDark, borderColor: colors.success },
  cellCallable: { borderColor: colors.accent, borderWidth: 2 },
  cellText: { fontFamily: fonts.headlineBold, color: colors.ink, fontSize: 20 },
  cellTextCut: { color: colors.success, textDecorationLine: 'line-through' },
  cutMark: { position: 'absolute', top: 2, right: 2 },
  scoresContainer: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, flexWrap: 'wrap' },
  scoreItem: {
    backgroundColor: colors.paperMuted, borderRadius: radius.hairline, padding: 10,
    alignItems: 'center', flex: 1, minWidth: 80,
    borderWidth: 1, borderColor: colors.ruleFaint,
  },
  myScoreItem: { borderWidth: 1.5, borderColor: colors.accent },
  scoreName: { fontFamily: fonts.body, color: colors.inkFaded, fontSize: 11 },
  scoreValue: { fontFamily: fonts.headlineBold, color: colors.ink, fontSize: 18, marginTop: 2 },
  myScore: { fontFamily: fonts.bodyItalic, color: colors.inkFaded, textAlign: 'center', fontSize: 13, paddingVertical: 4 },
  rule: { marginHorizontal: spacing.lg },
  callHistoryContainer: { padding: spacing.lg, gap: spacing.sm },
  callHistoryTitle: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded,
  },
  callHistoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  calledChip: {
    backgroundColor: colors.paperMuted, borderWidth: 1, borderColor: colors.ruleFaint,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 44, alignItems: 'center',
  },
  calledChipText: { fontFamily: fonts.bodyBold, color: colors.ink, fontSize: 15 },
  footer: { marginTop: 'auto', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  footerText: {
    fontFamily: fonts.bodyItalic, fontSize: 12, color: colors.inkFaint, textAlign: 'center',
  },
})
