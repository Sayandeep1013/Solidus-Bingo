/**
 * app/(app)/bot-game.tsx — BotGameScreen
 *
 * Single-player practice mode against 1-3 local bots. No network, no
 * realtime channel, no Supabase writes — fully isolated from multiplayer
 * state (spec bingo-play-vs-bot Req 4).
 */
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useBotGameStore, HUMAN_PLAYER_ID, selectCutIndices } from '@/store/botGameStore'

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
  const callNumber = useBotGameStore((s) => s.callNumber)
  const reset = useBotGameStore((s) => s.reset)

  const [isBotThinking, setIsBotThinking] = useState(false)
  const botTurnHandledRef = useRef<string | null>(null)

  const myBoard = boards[HUMAN_PLAYER_ID]
  const isMyTurn = status === 'ACTIVE' && activePlayerId === HUMAN_PLAYER_ID
  const cutIndices = selectCutIndices(myBoard, calledNumbers)
  const myScore = scoreMap[HUMAN_PLAYER_ID] ?? 0
  const activePlayer = players.find((p) => p.playerId === activePlayerId)

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
      <View style={styles.loading}>
        <ActivityIndicator color="#ffffff" size="large" />
        <Text style={styles.loadingText}>Setting up…</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.leaveTop} onPress={handleLeave} accessibilityRole="button" accessibilityLabel="Leave practice game">
        <Text style={styles.leaveTopText}>← Leave</Text>
      </TouchableOpacity>

      {/* Turn indicator */}
      <View style={[styles.turnBanner, isMyTurn && styles.myTurnBanner]}>
        <Text style={styles.turnText}>
          {isMyTurn ? '🎯 Your Turn' : `${activePlayer?.displayName ?? 'Opponent'}'s turn…`}
        </Text>
        {isBotThinking && <ActivityIndicator color="#ffffff" size="small" style={{ marginLeft: 8 }} />}
      </View>

      {/* 5×5 Board */}
      <View style={styles.boardContainer}>
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
                <Text style={[styles.cellText, isCut && styles.cellTextCut]}>{num}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
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

      {/* Call history */}
      <View style={styles.callHistoryContainer}>
        <Text style={styles.callHistoryTitle}>Called ({calledNumbers.length}/25)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.callHistoryRow}>
            {[...calledNumbers].reverse().map((n, i) => (
              <View key={i} style={styles.calledChip}>
                <Text style={styles.calledChipText}>{n}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loading: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#aaaaaa', fontSize: 14 },
  leaveTop: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  leaveTopText: { color: '#6c63ff', fontSize: 14 },
  turnBanner: {
    backgroundColor: '#2a2a40', paddingVertical: 12,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  myTurnBanner: { backgroundColor: '#1a2a1a' },
  turnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  boardContainer: { padding: 16, alignItems: 'center' },
  board: { width: 320, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: {
    width: 60, height: 60, backgroundColor: '#2a2a40',
    borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  cellCut: { backgroundColor: '#1a3a2a', borderColor: '#00cc88' },
  cellCallable: { borderColor: '#6c63ff' },
  cellText: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  cellTextCut: { color: '#00cc88' },
  scoresContainer: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, flexWrap: 'wrap' },
  scoreItem: {
    backgroundColor: '#2a2a40', borderRadius: 8, padding: 10,
    alignItems: 'center', flex: 1, minWidth: 80,
  },
  myScoreItem: { borderWidth: 1, borderColor: '#6c63ff' },
  scoreName: { color: '#aaaaaa', fontSize: 11 },
  scoreValue: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  myScore: { color: '#aaaaaa', textAlign: 'center', fontSize: 13, paddingVertical: 4 },
  callHistoryContainer: { padding: 16, gap: 6 },
  callHistoryTitle: { color: '#888888', fontSize: 12 },
  callHistoryRow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  calledChip: { backgroundColor: '#2a2a40', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  calledChipText: { color: '#cccccc', fontSize: 14, fontWeight: '600' },
})
