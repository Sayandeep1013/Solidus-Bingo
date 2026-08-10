/**
 * app/(app)/game/[gameId].tsx — GameScreen
 *
 * 5×5 bingo board, scores, turn indicator, call history.
 *
 * Spec: bingo-game-mechanics §Req 8, bingo-state-management §Req 8
 * - Board renders from myCutBoard derived selector
 * - Tap cell → call-number Edge Function (only when isMyTurn)
 * - game FINISHED/ABANDONED → navigate to ResultScreen
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
import {
  useGameStore,
  selectIsMyTurn,
  selectMyCutIndices,
  selectMyScore,
} from '@/store/gameStore'
import { useConnectionStore, selectIsConnected } from '@/store/connectionStore'
import { resetRoomStores } from '@/store'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { ErrorNotification } from '@/components/ErrorNotification'

export default function GameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>()
  const { userId } = useAuth()

  const gameStatus = useGameStore((s) => s.gameStatus)
  const myBoard = useGameStore((s) => s.myBoard)
  const calledNumbers = useGameStore((s) => s.calledNumbers)
  const scoreMap = useGameStore((s) => s.scoreMap)
  const activePlayerId = useGameStore((s) => s.activePlayerId)
  const lastCallSequence = useGameStore((s) => s.lastCallSequence)

  const isMyTurn = useGameStore(selectIsMyTurn(userId))
  const cutIndices = useGameStore(selectMyCutIndices)
  const myScore = useGameStore(selectMyScore(userId))
  const isConnected = useConnectionStore(selectIsConnected)

  const [isCalling, setIsCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  const handleRetry = () => {
    useConnectionStore.getState().setReconnecting()
  }

  const handleLeaveOnDisconnect = async () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)')
    resetRoomStores()
  }

  // Navigate to result screen when game ends
  useEffect(() => {
    if (gameStatus === 'FINISHED' || gameStatus === 'ABANDONED') {
      router.replace(`/(app)/result/${gameId}`)
    }
  }, [gameStatus, gameId])

  const handleCellTap = async (cellIndex: number) => {
    if (!isMyTurn || !myBoard || isCalling || !isConnected) return

    const number = myBoard[cellIndex]
    if (cutIndices.has(cellIndex)) return // already called

    setIsCalling(true)
    setCallError(null)

    try {
      const nextSequence = lastCallSequence + 1
      const { data, error } = await invokeEdgeFunction('call-number', {
        body: { game_id: gameId, number, sequence: nextSequence },
      })

      if (error || !data?.ok) {
        const errCode = data?.error?.code
        const messages: Record<string, string> = {
          NOT_YOUR_TURN: 'Not your turn',
          NUMBER_ALREADY_CALLED: 'Already called',
          CONCURRENT_CONFLICT: 'Conflict — try again',
          GAME_FINISHED: 'Game is finished',
        }
        setCallError(messages[errCode] ?? data?.error?.message ?? 'Call failed')
      }
      // State updates via Realtime events
    } catch {
      setCallError('Network error')
    } finally {
      setIsCalling(false)
    }
  }

  if (!myBoard) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#ffffff" size="large" />
        <Text style={styles.loadingText}>Loading game…</Text>
      </View>
    )
  }

  const isActivePlayer = activePlayerId === userId

  return (
    <View style={styles.container}>
      {/* Connection banner / disconnected overlay */}
      <ConnectionBanner onRetry={handleRetry} onLeave={handleLeaveOnDisconnect} />

      {/* Turn indicator */}
      <View style={[styles.turnBanner, isActivePlayer && styles.myTurnBanner]}>
        <Text style={styles.turnText}>
          {isActivePlayer ? '🎯 Your Turn' : `Waiting for opponent…`}
        </Text>
        {isCalling && <ActivityIndicator color="#ffffff" size="small" style={{ marginLeft: 8 }} />}
      </View>

      {callError ? (
        <Text style={styles.callError}>{callError}</Text>
      ) : null}

      {/* 5×5 Board */}
      <View style={styles.boardContainer}>
        <View style={styles.board}>
          {myBoard.map((num, idx) => {
            const isCut = cutIndices.has(idx)
            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.cell,
                  isCut && styles.cellCut,
                  isMyTurn && !isCut && styles.cellCallable,
                ]}
                onPress={() => handleCellTap(idx)}
                disabled={!isMyTurn || isCut || !isConnected}
                accessibilityRole="button"
                accessibilityLabel={`Number ${num}${isCut ? ', called' : ''}`}
                accessibilityState={{ disabled: !isMyTurn || isCut }}
              >
                <Text style={[styles.cellText, isCut && styles.cellTextCut]}>
                  {num}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {/* Scores */}
      <View style={styles.scoresContainer}>
        {Object.entries(scoreMap).map(([pId, score]) => (
          <View key={pId} style={[styles.scoreItem, pId === userId && styles.myScoreItem]}>
            <Text style={styles.scoreName}>
              {pId === userId ? 'You' : 'Opponent'}
              {pId === activePlayerId ? ' •' : ''}
            </Text>
            <Text style={styles.scoreValue}>{score}/5</Text>
          </View>
        ))}
      </View>

      {/* My score */}
      <Text style={styles.myScore}>Your lines: {myScore} / 5</Text>

      {/* Call history */}
      <View style={styles.callHistoryContainer}>
        <Text style={styles.callHistoryTitle}>
          Called ({calledNumbers.length}/25)
        </Text>
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
      {/* Call error notification */}
      <ErrorNotification
        message={callError}
        onDismiss={() => setCallError(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loading: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#aaaaaa', fontSize: 14 },
  turnBanner: {
    backgroundColor: '#2a2a40', paddingVertical: 12,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  myTurnBanner: { backgroundColor: '#1a2a1a' },
  turnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  reconnectBanner: { backgroundColor: '#2a1a3a', paddingVertical: 6, alignItems: 'center' },
  reconnectText: { color: '#cc99ff', fontSize: 12 },
  callError: { color: '#ff6b6b', fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  boardContainer: { padding: 16, alignItems: 'center' },
  board: {
    width: 320, flexDirection: 'row', flexWrap: 'wrap', gap: 4,
  },
  cell: {
    width: 60, height: 60, backgroundColor: '#2a2a40',
    borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  cellCut: { backgroundColor: '#1a3a2a', borderColor: '#00cc88' },
  cellCallable: { borderColor: '#6c63ff' },
  cellText: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  cellTextCut: { color: '#00cc88' },
  scoresContainer: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 8, flexWrap: 'wrap',
  },
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
  calledChip: {
    backgroundColor: '#2a2a40', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  calledChipText: { color: '#cccccc', fontSize: 14, fontWeight: '600' },
})
