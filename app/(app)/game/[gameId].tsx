/**
 * app/(app)/game/[gameId].tsx — GameScreen
 *
 * 5×5 bingo board, scores, turn indicator, call history, chess-clock time
 * bank per player.
 *
 * Spec: bingo-game-mechanics §Req 8, bingo-state-management §Req 8;
 * bingo-disconnect-recovery §3.2 (time bank), §3.7 (self-forfeit)
 * - Board renders from myCutBoard derived selector
 * - Tap cell → call-number Edge Function (only when isMyTurn)
 * - game FINISHED/ABANDONED → navigate to ResultScreen
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import {
  useGameStore,
  selectIsMyTurn,
  selectMyCutIndices,
  selectMyScore,
  selectMyCompletedLines,
} from '@/store/gameStore'
import { useConnectionStore, selectIsConnected } from '@/store/connectionStore'
import { usePresenceStore, useRoomStore, resetRoomStores } from '@/store'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { ErrorNotification } from '@/components/ErrorNotification'
import { colors, fonts, spacing, radius, KICKER_LETTER_SPACING } from '@/theme'
import {
  PaperBackground, Divider, NewsCard, NewsButton, ConfirmDialog, ForfeitVoteTallyDialog,
  BingoLineMark, BOARD_CELL, BOARD_GAP, BOARD_SIZE,
} from '@/components/news'

// Matches rooms.disconnect_grace_ms's DB default (spec bingo-disconnect-recovery
// §3.3.2) — no room-creation UI exposes configuring this yet, so the client
// timer just mirrors the default rather than round-tripping to fetch it.
const DISCONNECT_GRACE_MS = 30_000

// Bot "thinking" delay — same range as the local practice-bot (bot-game.tsx)
// so a bot-controlled seat in a real multiplayer game feels consistent with
// the one already familiar from Play vs Bot (spec §3.5.2).
const BOT_DELAY_MIN_MS = 900
const BOT_DELAY_MAX_MS = 2200

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

export default function GameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>()
  const { userId } = useAuth()
  const insets = useSafeAreaInsets()

  const gameStatus = useGameStore((s) => s.gameStatus)
  const myBoard = useGameStore((s) => s.myBoard)
  const calledNumbers = useGameStore((s) => s.calledNumbers)
  const scoreMap = useGameStore((s) => s.scoreMap)
  const activePlayerId = useGameStore((s) => s.activePlayerId)
  const lastCallSequence = useGameStore((s) => s.lastCallSequence)
  const turnStartedAt = useGameStore((s) => s.turnStartedAt)
  const timeRemainingMs = useGameStore((s) => s.timeRemainingMs)
  const outPlayerIds = useGameStore((s) => s.outPlayerIds)
  const botControlledPlayerIds = useGameStore((s) => s.botControlledPlayerIds)
  const pendingForfeitVote = useGameStore((s) => s.pendingForfeitVote)
  const forfeitVoteBallots = useGameStore((s) => s.forfeitVoteBallots)
  const presenceRoster = usePresenceStore((s) => s.presenceRoster)
  const capacity = useRoomStore((s) => s.capacity)
  const roomPlayers = useRoomStore((s) => s.players)

  const isMyTurn = useGameStore(selectIsMyTurn(userId))
  const cutIndices = useGameStore(selectMyCutIndices)
  const myScore = useGameStore(selectMyScore(userId))
  const myCompletedLines = useGameStore(selectMyCompletedLines(userId))
  const isConnected = useConnectionStore(selectIsConnected)

  const [isCalling, setIsCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)
  const [isClaimingTimeout, setIsClaimingTimeout] = useState(false)
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false)
  const [isForfeiting, setIsForfeiting] = useState(false)
  const [castingVoteChoice, setCastingVoteChoice] = useState<'YES' | 'NO' | null>(null)

  // Per-opponent grace-period timers (spec §3.3.2) — keyed by playerId so a
  // reconnect can cancel just that player's pending timer without touching
  // any other concurrently-tracked disconnect in a 3-4p game.
  const disconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const cancelledVoteIdsRef = useRef<Set<string>>(new Set())
  const expiredVoteIdsRef = useRef<Set<string>>(new Set())
  const botMoveScheduledForRef = useRef<string | null>(null)

  // Ticks once a second while the game is active so the countdown displays
  // (computed below, not stored) stay live without a network round-trip.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (gameStatus !== 'ACTIVE') return
    const interval = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [gameStatus])

  // Disconnect detection (spec §3.3): watch every fellow non-out player's
  // Presence entry; if one drops and stays gone for the full grace period,
  // report it. The server independently decides auto-forfeit vs. starting a
  // vote based on the room's time bank (design.md §5) — this client only
  // ever reports "they've been gone 30s," never claims the outcome itself.
  //
  // Bot-controlled seats are deliberately excluded here too: without this,
  // a still-absent bot-controlled player would get *another* disconnect
  // vote started against them ~30s later, and — with no human left to vote
  // NO a second time — it would auto-pass via the expiry tie-break and
  // forfeit them outright, defeating the entire point of bot takeover
  // (spec §3.5: the bot keeps playing for them until they actually
  // reconnect, not until the next grace timer happens to fire).
  useEffect(() => {
    if (gameStatus !== 'ACTIVE' || !userId) return

    const opponentIds = Object.keys(scoreMap).filter((id) => id !== userId)
    const timers = disconnectTimersRef.current

    for (const opponentId of opponentIds) {
      const isOut = outPlayerIds[opponentId] === true
      const isOnline = opponentId in presenceRoster
      const isBotControlled = botControlledPlayerIds[opponentId] === true
      const hasTimer = timers.has(opponentId)

      if (isOut || isOnline || isBotControlled) {
        if (hasTimer) {
          clearTimeout(timers.get(opponentId)!)
          timers.delete(opponentId)
        }
        continue
      }

      if (!hasTimer) {
        const timer = setTimeout(() => {
          timers.delete(opponentId)
          invokeEdgeFunction('initiate-disconnect-resolution', {
            body: { game_id: gameId, disconnected_player_id: opponentId },
          }).then(({ data }) => {
            if (data?.data?.mode === 'VOTE_STARTED') {
              useGameStore.getState().setPendingForfeitVote({
                voteId: data.data.vote_id,
                targetPlayerId: data.data.target_player_id,
                status: 'PENDING',
                expiresAt: data.data.expires_at,
              })
            }
          }).catch(() => { /* a later presence/grace cycle will retry */ })
        }, DISCONNECT_GRACE_MS)
        timers.set(opponentId, timer)
      }
    }

    // Drop timers for players no longer in scoreMap at all (shouldn't
    // normally happen mid-game, but keeps the map from leaking).
    for (const trackedId of Array.from(timers.keys())) {
      if (!opponentIds.includes(trackedId)) {
        clearTimeout(timers.get(trackedId)!)
        timers.delete(trackedId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus, gameId, userId, presenceRoster, outPlayerIds, botControlledPlayerIds, pendingForfeitVote?.status])

  useEffect(() => {
    const timers = disconnectTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // Req 3.4.5: if I'm the target of a pending vote, the mere fact my own
  // client can make this authenticated call proves I'm back — cancel it
  // immediately rather than let it run to expiry against me.
  useEffect(() => {
    if (!pendingForfeitVote || pendingForfeitVote.status !== 'PENDING') return
    if (pendingForfeitVote.targetPlayerId !== userId) return
    if (cancelledVoteIdsRef.current.has(pendingForfeitVote.voteId)) return

    cancelledVoteIdsRef.current.add(pendingForfeitVote.voteId)
    invokeEdgeFunction('cancel-forfeit-vote', { body: { vote_id: pendingForfeitVote.voteId } }).catch(() => {})
  }, [pendingForfeitVote, userId])

  // Any present, non-target client resolves an expired-but-still-PENDING
  // vote once its window has closed — same "client reports, server
  // verifies" pattern as claim-timeout-win.
  useEffect(() => {
    if (!pendingForfeitVote || pendingForfeitVote.status !== 'PENDING') return
    if (pendingForfeitVote.targetPlayerId === userId) return
    if (nowTick < new Date(pendingForfeitVote.expiresAt).getTime()) return
    if (expiredVoteIdsRef.current.has(pendingForfeitVote.voteId)) return

    expiredVoteIdsRef.current.add(pendingForfeitVote.voteId)
    invokeEdgeFunction('resolve-expired-vote', { body: { vote_id: pendingForfeitVote.voteId } }).catch(() => {})
  }, [pendingForfeitVote, userId, nowTick])

  // Bot takeover (spec §3.5): any present, still-in-rotation player notices
  // via Realtime that the active seat is bot_controlled, and — after the
  // same "thinking" delay the local practice-bot uses — plays a move on its
  // behalf. Every present client independently schedules this; whoever's
  // timer fires first wins via resolveCall's sequence check, the rest get
  // CONCURRENT_CONFLICT and silently no-op (design.md §1.2). Keyed on
  // lastCallSequence (not just activePlayerId) so a seat that cycles back
  // to bot-controlled-and-active later in the same game gets rescheduled.
  useEffect(() => {
    if (gameStatus !== 'ACTIVE' || !userId || !activePlayerId) return
    if (outPlayerIds[userId] === true) return
    if (!botControlledPlayerIds[activePlayerId]) return

    const scheduleKey = `${gameId}:${activePlayerId}:${lastCallSequence}`
    if (botMoveScheduledForRef.current === scheduleKey) return
    botMoveScheduledForRef.current = scheduleKey

    const delay = BOT_DELAY_MIN_MS + Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS)
    const timer = setTimeout(() => {
      invokeEdgeFunction('submit-bot-move', { body: { game_id: gameId } }).catch(() => {
        // Lost the race to another present client, or the seat was
        // reclaimed in the meantime — either way, nothing to do here.
      })
    }, delay)

    return () => clearTimeout(timer)
  }, [gameStatus, gameId, userId, activePlayerId, lastCallSequence, botControlledPlayerIds, outPlayerIds])

  // Req 3.5.3: the instant I notice my own seat is bot_controlled (I just
  // reconnected while a bot was covering for me), reclaim it immediately —
  // no waiting for a re-vote or my next turn.
  const isReclaimingRef = useRef(false)
  useEffect(() => {
    if (!userId || !botControlledPlayerIds[userId]) return
    if (isReclaimingRef.current) return

    isReclaimingRef.current = true
    invokeEdgeFunction('reclaim-seat', { body: { game_id: gameId } })
      .catch(() => {})
      .finally(() => { isReclaimingRef.current = false })
  }, [gameId, userId, botControlledPlayerIds])

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

  // Live display value for a given player's clock — ticking down for
  // whoever's turn it currently is, frozen for everyone else. Pure
  // client-side math off nowTick; the server is the actual authority
  // (see claim-timeout-win, which re-derives this independently).
  const displayRemainingMs = (playerId: string): number => {
    const base = timeRemainingMs[playerId] ?? 0
    if (playerId !== activePlayerId || !turnStartedAt) return base
    const elapsed = nowTick - new Date(turnStartedAt).getTime()
    return Math.max(0, base - elapsed)
  }

  const opponentEntry = Object.keys(scoreMap).find((pId) => pId !== userId)
  const opponentTimedOut =
    gameStatus === 'ACTIVE' && !isMyTurn && !!opponentEntry && displayRemainingMs(opponentEntry) <= 0

  // D3: 2-player disconnects get a single accept/deny prompt; 3-4p gets a
  // live tally (spec §3.4.2) since more than one other player can be
  // voting at once. The backend vote mechanism itself is capacity-agnostic
  // — this is purely which dialog component renders.
  const effectiveCapacity = capacity ?? Object.keys(scoreMap).length
  const isVotePending = !!pendingForfeitVote && pendingForfeitVote.status === 'PENDING'
  const iAmEligibleVoter =
    isVotePending && pendingForfeitVote!.targetPlayerId !== userId
  const showDisconnectVotePrompt = iAmEligibleVoter && effectiveCapacity === 2
  const showForfeitVoteTally = iAmEligibleVoter && effectiveCapacity >= 3
  const voteSecondsLeft = pendingForfeitVote
    ? Math.max(0, Math.ceil((new Date(pendingForfeitVote.expiresAt).getTime() - nowTick) / 1000))
    : 0

  // Eligible voters = every non-out player except the target (mirrors the
  // server's own eligibility check in cast-forfeit-vote) — used for the
  // live "X of Y voted" tally.
  const eligibleVoterIds = pendingForfeitVote
    ? Object.keys(scoreMap).filter(
        (id) => id !== pendingForfeitVote.targetPlayerId && outPlayerIds[id] !== true
      )
    : []
  const voteYesCount = eligibleVoterIds.filter((id) => forfeitVoteBallots[id] === 'YES').length
  const voteNoCount = eligibleVoterIds.filter((id) => forfeitVoteBallots[id] === 'NO').length
  const myVoteChoice = userId ? (forfeitVoteBallots[userId] ?? null) : null
  const forfeitTargetUsername = pendingForfeitVote
    ? (roomPlayers.find((p) => p.playerId === pendingForfeitVote.targetPlayerId)?.username ?? 'this player')
    : ''

  const handleClaimTimeout = async () => {
    setIsClaimingTimeout(true)
    setCallError(null)
    try {
      const { data, error } = await invokeEdgeFunction('claim-timeout-win', {
        body: { game_id: gameId },
      })
      if (error || !data?.ok) {
        const errCode = data?.error?.code
        const messages: Record<string, string> = {
          TOO_SOON: 'Their clock hasn’t actually run out yet',
          GAME_NOT_ACTIVE: 'Game already ended',
          NOT_STALLED: "It's your turn — nothing to claim",
        }
        setCallError(messages[errCode] ?? data?.error?.message ?? 'Could not claim timeout win')
      }
      // Success updates arrive via the games UPDATE Realtime event, same as
      // a normal win/draw.
    } catch {
      setCallError('Network error')
    } finally {
      setIsClaimingTimeout(false)
    }
  }

  // Voluntary concede — spec bingo-disconnect-recovery §3.7. Deliberately
  // not placed near the board or turn banner (not "direct line of sight");
  // it lives as a small link in the footer, confirm-gated so a stray tap
  // can't end the game by accident.
  const handleForfeitSelf = async () => {
    setIsForfeiting(true)
    try {
      await invokeEdgeFunction('forfeit-self', { body: { game_id: gameId } })
      // Success updates arrive via the games UPDATE Realtime event, same as
      // any other way a game ends.
    } finally {
      setIsForfeiting(false)
      setShowForfeitConfirm(false)
    }
  }

  // 2-player simplified prompt (spec D3 / Req 3.4.1) — "claim" casts YES,
  // "keep waiting" casts NO (fails this attempt; a still-missing opponent
  // starts a fresh grace timer and can be reported again later). Declining
  // is deliberately distinct from silently dismissing: not deciding at all
  // still resolves in the claimant's favor once the window expires
  // (Req 3.4.4's approved tie-break), matching "no response isn't a deny."
  const handleCastForfeitVote = async (choice: 'YES' | 'NO') => {
    if (!pendingForfeitVote) return
    setCastingVoteChoice(choice)
    try {
      await invokeEdgeFunction('cast-forfeit-vote', {
        body: { vote_id: pendingForfeitVote.voteId, choice },
      })
      // PASSED result arrives via the games UPDATE Realtime event; FAILED
      // clears pendingForfeitVote via the forfeit_votes UPDATE event.
    } finally {
      setCastingVoteChoice(null)
    }
  }

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
      <PaperBackground>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.ink} size="large" />
          <Text style={styles.loadingText}>Setting the type…</Text>
        </View>
      </PaperBackground>
    )
  }

  const isActivePlayer = activePlayerId === userId

  return (
    <PaperBackground>
      <View style={styles.container}>
        {/* Connection banner / disconnected overlay */}
        <ConnectionBanner onRetry={handleRetry} onLeave={handleLeaveOnDisconnect} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Turn indicator */}
          <View style={[styles.turnBanner, { paddingTop: insets.top + spacing.lg }]}>
            <View style={[styles.turnDot, isActivePlayer && styles.turnDotActive]} />
            <Text style={[styles.turnText, isActivePlayer && styles.turnTextActive]}>
              {isActivePlayer ? 'Your Turn' : 'Waiting for Opponent…'}
            </Text>
            {isCalling && <ActivityIndicator color={colors.accent} size="small" style={{ marginLeft: 8 }} />}
          </View>
          <Divider style={styles.turnRule} />

          {opponentTimedOut ? (
            <View style={styles.forfeitBox}>
              <Text style={styles.forfeitText}>
                Your opponent&apos;s clock has run out.
              </Text>
              <NewsButton
                label="Claim Win — Opponent Out of Time"
                onPress={handleClaimTimeout}
                variant="plain"
                loading={isClaimingTimeout}
                accessibilityLabel="Claim win due to opponent running out of time"
              />
            </View>
          ) : null}

          {callError ? <Text style={styles.callError}>{callError}</Text> : null}

          {/* 5×5 Board */}
          <View style={styles.boardContainer}>
            <NewsCard style={styles.boardCard}>
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

          {/* Scores + clocks */}
          <View style={styles.scoresContainer}>
            {Object.entries(scoreMap).map(([pId, score]) => (
              <View key={pId} style={[styles.scoreItem, pId === userId && styles.myScoreItem]}>
                <View style={styles.scoreNameRow}>
                  {botControlledPlayerIds[pId] ? (
                    <Ionicons name="hardware-chip-outline" size={11} color={colors.inkFaded} />
                  ) : null}
                  <Text style={styles.scoreName}>
                    {pId === userId ? 'You' : 'Opponent'}
                    {pId === activePlayerId ? ' •' : ''}
                  </Text>
                </View>
                <Text style={styles.scoreValue}>{score}/5</Text>
                <Text style={[styles.clockValue, pId === activePlayerId && styles.clockValueActive]}>
                  {formatClock(displayRemainingMs(pId))}
                </Text>
              </View>
            ))}
          </View>

          {/* My score */}
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
            <Text style={styles.footerText}>Solidus Bingo — Live Coverage</Text>
            <TouchableOpacity
              onPress={() => setShowForfeitConfirm(true)}
              accessibilityRole="button"
              accessibilityLabel="Leave and forfeit this game"
              style={styles.forfeitLink}
            >
              <Text style={styles.forfeitLinkText}>Not feeling this game? Leave it.</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Call error notification */}
        <ErrorNotification message={callError} onDismiss={() => setCallError(null)} />

        <ConfirmDialog
          visible={showForfeitConfirm}
          kicker="Reader's Notice"
          title="Leave this game?"
          message="You'll forfeit — this counts as a loss if it's ranked."
          confirmLabel="Forfeit"
          cancelLabel="Keep Playing"
          onConfirm={handleForfeitSelf}
          onCancel={() => setShowForfeitConfirm(false)}
          isConfirming={isForfeiting}
        />

        <ConfirmDialog
          visible={showDisconnectVotePrompt}
          kicker="Wire Service"
          title="Your opponent disconnected"
          message={`Claim the win? ${voteSecondsLeft}s left to decide — no response still resolves in your favor once time runs out.`}
          confirmLabel="Claim Win"
          cancelLabel="Keep Waiting"
          onConfirm={() => handleCastForfeitVote('YES')}
          onCancel={() => handleCastForfeitVote('NO')}
          isConfirming={castingVoteChoice === 'YES'}
        />

        <ForfeitVoteTallyDialog
          visible={showForfeitVoteTally}
          targetUsername={forfeitTargetUsername}
          totalEligible={eligibleVoterIds.length}
          yesCount={voteYesCount}
          noCount={voteNoCount}
          secondsLeft={voteSecondsLeft}
          myChoice={myVoteChoice}
          onVoteYes={() => handleCastForfeitVote('YES')}
          onVoteNo={() => handleCastForfeitVote('NO')}
          isVoting={castingVoteChoice !== null}
        />
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
  turnBanner: {
    paddingBottom: spacing.md,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.xs,
  },
  turnDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkFaint },
  turnDotActive: { backgroundColor: colors.accent },
  turnText: {
    fontFamily: fonts.display, fontSize: 18, color: colors.inkFaded,
  },
  turnTextActive: { fontFamily: fonts.displayHeavy, color: colors.accent },
  turnRule: { marginHorizontal: spacing.lg },
  forfeitBox: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  forfeitText: {
    fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.inkFaded, textAlign: 'center',
  },
  callError: { fontFamily: fonts.body, color: colors.accent, fontSize: 12, textAlign: 'center', paddingVertical: 4 },
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
  board: {
    width: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap', gap: BOARD_GAP,
  },
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
  scoresContainer: {
    flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, flexWrap: 'wrap',
  },
  scoreItem: {
    backgroundColor: colors.paperMuted, borderRadius: radius.hairline, padding: 10,
    alignItems: 'center', flex: 1, minWidth: 80,
    borderWidth: 1, borderColor: colors.ruleFaint,
  },
  myScoreItem: { borderWidth: 1.5, borderColor: colors.accent },
  scoreNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  scoreName: { fontFamily: fonts.body, color: colors.inkFaded, fontSize: 11 },
  scoreValue: { fontFamily: fonts.headlineBold, color: colors.ink, fontSize: 18, marginTop: 2 },
  clockValue: {
    fontFamily: fonts.bodyBold, color: colors.inkFaint, fontSize: 13, marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  clockValueActive: { color: colors.accent },
  myScore: { fontFamily: fonts.bodyItalic, color: colors.inkFaded, textAlign: 'center', fontSize: 13, paddingVertical: 4 },
  rule: { marginHorizontal: spacing.lg },
  callHistoryContainer: { padding: spacing.lg, gap: spacing.xs },
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
  forfeitLink: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  forfeitLinkText: {
    fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, textDecorationLine: 'underline',
  },
})
