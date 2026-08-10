/**
 * app/(app)/ranked-play.tsx — RankedPlayScreen
 *
 * Party-size picker + matchmaking search. Spec:
 * .kiro/specs/bingo-ranked-matchmaking/requirements.md
 *
 * Unlike Create/Join Room, a ranked match already has its game created by
 * the time the client learns about it (join-queue does everything
 * server-side in one shot), so there is no lobby step — this screen fetches
 * the game snapshot directly and navigates straight into GameScreen.
 */
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { applyGameSnapshot } from '@/lib/gameSnapshot'
import { useRoomStore } from '@/store/roomStore'

const PARTY_SIZES = [2, 3, 4] as const

export default function RankedPlayScreen() {
  const [phase, setPhase] = useState<'picking' | 'searching'>('picking')
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [error, setError] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      const { data, error: fnError } = await invokeEdgeFunction('join-queue', { body: { capacity } })

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
      <View style={styles.container}>
        <View style={styles.searchingBox}>
          <ActivityIndicator color="#6c63ff" size="large" />
          <Text style={styles.searchingTitle}>Searching for players…</Text>
          <Text style={styles.searchingSubtitle}>
            {capacity} players • {elapsedSec}s elapsed
          </Text>
        </View>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel search"
        >
          <Text style={styles.cancelButtonText}>Cancel Search</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Ranked Play</Text>
      <Text style={styles.subtitle}>Pick a party size — you&apos;ll be matched with other players automatically.</Text>

      <View style={styles.optionRow}>
        {PARTY_SIZES.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.option, capacity === n && styles.optionSelected]}
            onPress={() => setCapacity(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: capacity === n }}
            accessibilityLabel={`${n} players`}
          >
            <Text style={[styles.optionText, capacity === n && styles.optionTextSelected]}>{n}</Text>
            <Text style={styles.optionLabel}>players</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.playButton, isSubmitting && styles.disabled]}
        onPress={handleFindMatch}
        disabled={isSubmitting}
        accessibilityRole="button"
        accessibilityLabel="Find match"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.playButtonText}>Find Match</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingTop: 60, gap: 20 },
  backButton: { marginBottom: 8 },
  backText: { color: '#6c63ff', fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  subtitle: { fontSize: 16, color: '#aaaaaa' },
  optionRow: { flexDirection: 'row', gap: 12 },
  option: {
    flex: 1, paddingVertical: 20, borderRadius: 12,
    backgroundColor: '#2a2a40', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  optionSelected: { borderColor: '#6c63ff', backgroundColor: '#2a2a50' },
  optionText: { fontSize: 32, fontWeight: 'bold', color: '#888888' },
  optionTextSelected: { color: '#ffffff' },
  optionLabel: { fontSize: 12, color: '#666666', marginTop: 4 },
  errorText: { color: '#ff6b6b', fontSize: 14 },
  playButton: {
    backgroundColor: '#6c63ff', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  disabled: { opacity: 0.5 },
  playButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  searchingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  searchingTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  searchingSubtitle: { color: '#888888', fontSize: 14 },
  cancelButton: {
    backgroundColor: '#2a2a40', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', marginBottom: 40, borderWidth: 1, borderColor: '#3a3a55',
  },
  cancelButtonText: { color: '#cc4444', fontSize: 16, fontWeight: '600' },
})
