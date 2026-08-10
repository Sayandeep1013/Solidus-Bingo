/**
 * app/(app)/create-room.tsx — CreateRoomScreen
 *
 * Capacity picker (2, 3, 4) + Create button.
 * Calls create-room Edge Function and navigates to lobby on success.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { useRoomStore } from '@/store/roomStore'

const CAPACITIES = [2, 3, 4] as const

export default function CreateRoomScreen() {
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRoom = useRoomStore((s) => s.setRoom)

  const handleCreate = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await invokeEdgeFunction('create-room', {
        body: { capacity },
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
        players: [],
      })

      router.replace(`/(app)/lobby/${room.room_id}`)
    } catch (err) {
      setError('Network error — please try again')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Create a Room</Text>
      <Text style={styles.subtitle}>How many players?</Text>

      <View style={styles.capacityRow}>
        {CAPACITIES.map((cap) => (
          <TouchableOpacity
            key={cap}
            style={[styles.capacityOption, capacity === cap && styles.capacitySelected]}
            onPress={() => setCapacity(cap)}
            accessibilityRole="radio"
            accessibilityState={{ selected: capacity === cap }}
            accessibilityLabel={`${cap} players`}
          >
            <Text
              style={[styles.capacityText, capacity === cap && styles.capacityTextSelected]}
            >
              {cap}
            </Text>
            <Text style={styles.capacityLabel}>players</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.createButton, isLoading && styles.disabled]}
        onPress={handleCreate}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel="Create room"
      >
        {isLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.createButtonText}>Create Room</Text>
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
  capacityRow: { flexDirection: 'row', gap: 12 },
  capacityOption: {
    flex: 1, paddingVertical: 20, borderRadius: 12,
    backgroundColor: '#2a2a40', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  capacitySelected: { borderColor: '#6c63ff', backgroundColor: '#2a2a50' },
  capacityText: { fontSize: 32, fontWeight: 'bold', color: '#888888' },
  capacityTextSelected: { color: '#ffffff' },
  capacityLabel: { fontSize: 12, color: '#666666', marginTop: 4 },
  errorText: { color: '#ff6b6b', fontSize: 14 },
  createButton: {
    backgroundColor: '#6c63ff', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  disabled: { opacity: 0.5 },
  createButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
})
