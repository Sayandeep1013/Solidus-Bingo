/**
 * app/(app)/create-room.tsx — CreateRoomScreen
 *
 * Capacity picker (2, 3, 4) + time bank picker + Create button.
 * Calls create-room Edge Function and navigates to lobby on success.
 */
import { useState } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { useRoomStore } from '@/store/roomStore'
import { colors, fonts, spacing } from '@/theme'
import {
  PageHeader, PaperBackground, NewsButton, CapacityPicker, SectionLabel,
  TimeBankPicker, TIME_BANK_PRESETS_MS, type TimeBankMs,
} from '@/components/news'

export default function CreateRoomScreen() {
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [timeBankMs, setTimeBankMs] = useState<TimeBankMs>(TIME_BANK_PRESETS_MS[1]) // 5 min default
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRoom = useRoomStore((s) => s.setRoom)

  const handleCreate = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await invokeEdgeFunction('create-room', {
        body: { capacity, time_bank_ms: timeBankMs },
      })

      if (fnError || !data?.data) {
        setError(data?.error?.message ?? fnError?.message ?? 'Failed to create room')
        return
      }

      const room = data.data
      setRoom({
        roomId: room.room_id,
        roomCode: room.code,
        capacity: room.capacity,
        roomStatus: room.status,
        hostId: room.host_id,
        players: (room.players ?? []).map((p: { player_id: string; username: string | null; join_order: number }) => ({
          playerId: p.player_id,
          username: p.username,
          joinOrder: p.join_order,
          isOnline: true,
        })),
      })

      router.replace(`/(app)/lobby/${room.room_id}`)
    } catch (err) {
      setError('Network error — please try again')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PaperBackground>
      <PageHeader title="Create a Room" backLabel="Back" />
      <View style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.subtitle}>How many players?</Text>
          <CapacityPicker value={capacity} onChange={setCapacity} />
        </View>

        <View style={styles.section}>
          <SectionLabel>Time Bank — Per Player</SectionLabel>
          <TimeBankPicker value={timeBankMs} onChange={setTimeBankMs} />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <NewsButton
          label="Create Room"
          onPress={handleCreate}
          variant="accent"
          loading={isLoading}
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
})
