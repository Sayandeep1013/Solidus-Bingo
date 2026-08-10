/**
 * app/(app)/ranked-play.tsx — RankedPlayScreen
 *
 * Party-size + time-bank picker + matchmaking search. Spec:
 * .kiro/specs/bingo-ranked-matchmaking/requirements.md;
 * .kiro/specs/bingo-disconnect-recovery/design.md §4 (matching is now
 * 2-dimensional — capacity AND time bank both have to agree, chess.com-style)
 *
 * Unlike Create/Join Room, a ranked match already has its game created by
 * the time the client learns about it (join-queue does everything
 * server-side in one shot), so there is no lobby step — this screen fetches
 * the game snapshot directly and navigates straight into GameScreen.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { applyGameSnapshot } from '@/lib/gameSnapshot'
import { useRoomStore } from '@/store/roomStore'
import { colors, fonts, spacing, KICKER_LETTER_SPACING } from '@/theme'
import {
  PaperBackground, PageHeader, NewsButton, CapacityPicker, SectionLabel,
  TimeBankPicker, TIME_BANK_PRESETS_MS, type TimeBankMs,
} from '@/components/news'

export default function RankedPlayScreen() {
  const [phase, setPhase] = useState<'picking' | 'searching'>('picking')
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [timeBankMs, setTimeBankMs] = useState<TimeBankMs>(TIME_BANK_PRESETS_MS[1]) // 5 min default
  const [error, setError] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const insets = useSafeAreaInsets()

  const setRoom = useRoomStore((s) => s.setRoom)
  const queueChannelRef = useRef<RealtimeChannel | null>(null)
  const enteringRef = useRef(false)

  useEffect(() => {
    if (phase !== 'searching') return
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  useEffect(() => () => {
    if (queueChannelRef.current) supabase.removeChannel(queueChannelRef.current)
  }, [])

  // Fetches the already-created game's snapshot and navigates straight in —
  // there is no lobby step for ranked matches (spec Req 3.3-3.4).
  const enterMatch = async (roomId: string, gameId: string, matchedCapacity: number) => {
    if (enteringRef.current) return
    enteringRef.current = true

    const { data } = await invokeEdgeFunction('get-game-state', { body: { game_id: gameId } })
    if (data?.data) applyGameSnapshot(data.data)

    setRoom({
      roomId,
      roomCode: null,
      capacity: matchedCapacity,
      roomStatus: 'IN_GAME',
      hostId: '',
      players: [],
    })

    router.replace(`/(app)/game/${gameId}`)
  }

  const handleFindMatch = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const { data, error: fnError } = await invokeEdgeFunction('join-queue', {
        body: { capacity, time_bank_ms: timeBankMs },
      })

      if (fnError || !data?.ok) {
        const code = data?.error?.code
        const messages: Record<string, string> = {
          ALREADY_QUEUED: "You're already searching for a match.",
          ALREADY_IN_GAME: 'Finish your current game before queueing for another.',
        }
        setError(messages[code] ?? data?.error?.message ?? fnError?.message ?? 'Failed to join queue')
        return
      }

      if (data.data.matched) {
        await enterMatch(data.data.room_id, data.data.game_id, capacity)
        return
      }

      const queueId = data.data.queue_id as string
      setElapsedSec(0)
      setPhase('searching')

      // Subscribe to my own queue row — the match may form later when
      // someone else queues for the same party size (spec Req 3.4).
      const channel = supabase
        .channel(`matchmaking:${queueId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'matchmaking_queue', filter: `id=eq.${queueId}` },
          async (payload) => {
            const row = payload.new as { status: string; matched_room_id: string | null }
            if (row.status === 'MATCHED' && row.matched_room_id) {
              const { data: stateData } = await invokeEdgeFunction('get-game-state', {
                body: { room_id: row.matched_room_id },
              })
              if (stateData?.data) {
                await enterMatch(row.matched_room_id, stateData.data.game_id, capacity)
              }
            }
          }
        )
        .subscribe()
      queueChannelRef.current = channel
    } catch {
      setError('Network error — please try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (queueChannelRef.current) {
      supabase.removeChannel(queueChannelRef.current)
      queueChannelRef.current = null
    }
    await invokeEdgeFunction('leave-queue', { body: {} })
    setPhase('picking')
  }

  if (phase === 'searching') {
    return (
      <PaperBackground>
        <View style={[styles.searchingContainer, { paddingTop: insets.top }]}>
          <View style={styles.searchingBox}>
            <MaterialCommunityIcons name="newspaper-variant-outline" size={48} color={colors.accent} />
            <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: spacing.sm }} />
            <Text style={styles.searchingKicker}>Wire Service</Text>
            <Text style={styles.searchingTitle}>Searching for players…</Text>
            <Text style={styles.searchingSubtitle}>
              {capacity} players • {timeBankMs / 60_000} min • {elapsedSec}s elapsed
            </Text>
          </View>

          <NewsButton label="Cancel Search" onPress={handleCancel} variant="plain" accessibilityLabel="Cancel search" />
        </View>
      </PaperBackground>
    )
  }

  return (
    <PaperBackground>
      <PageHeader title="Ranked Play" backLabel="Back" />
      <View style={styles.container}>
        <Text style={styles.subtitle}>Pick a party size and time bank — you&apos;ll be matched with other players choosing the same.</Text>

        <View style={styles.section}>
          <SectionLabel>Party Size</SectionLabel>
          <CapacityPicker value={capacity} onChange={setCapacity} />
        </View>

        <View style={styles.section}>
          <SectionLabel>Time Bank — Per Player</SectionLabel>
          <TimeBankPicker value={timeBankMs} onChange={setTimeBankMs} />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <NewsButton
          label="Find Match"
          onPress={handleFindMatch}
          disabled={isSubmitting}
          loading={isSubmitting}
          variant="accent"
          accessibilityLabel="Find match"
        />
      </View>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: spacing.lg },
  section: { gap: spacing.sm },
  subtitle: { fontFamily: fonts.body, fontSize: 16, color: colors.inkFaded },
  errorText: { fontFamily: fonts.body, color: colors.accent, fontSize: 14 },
  searchingContainer: { flex: 1, paddingHorizontal: 24, paddingBottom: 40, justifyContent: 'space-between' },
  searchingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  searchingKicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded, marginTop: spacing.md,
  },
  searchingTitle: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.ink, marginTop: spacing.xs },
  searchingSubtitle: { fontFamily: fonts.bodyItalic, fontSize: 14, color: colors.inkFaded },
})
