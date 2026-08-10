/**
 * app/(app)/join-room.tsx — JoinRoomScreen
 *
 * Code input (uppercase, 6 chars) + Join button.
 * Normalises to uppercase before sending to Edge Function.
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { router } from 'expo-router'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { useRoomStore } from '@/store/roomStore'

export default function JoinRoomScreen() {
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRoom = useRoomStore((s) => s.setRoom)

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 6) {
      setError('Room code must be exactly 6 characters')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const { data, error: fnError } = await invokeEdgeFunction('join-room', {
        body: { code: trimmed },
      })

      if (fnError || !data?.data) {
        const errCode = data?.error?.code
        const messages: Record<string, string> = {
          ROOM_NOT_FOUND: 'No room found with that code.',
          ROOM_NOT_JOINABLE: 'That room is not accepting players right now.',
          ROOM_FULL: 'That room is full.',
          ALREADY_IN_ROOM: 'You are already in that room.',
        }
        setError(messages[errCode] ?? data?.error?.message ?? fnError?.message ?? 'Failed to join room')
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

  const isDisabled = isLoading || code.trim().length !== 6

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Join a Room</Text>
      <Text style={styles.subtitle}>Enter the 6-character room code.</Text>

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={code}
        onChangeText={(t) => { setCode(t.toUpperCase()); setError(null) }}
        placeholder="e.g. ABC3DX"
        placeholderTextColor="#555555"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        returnKeyType="done"
        onSubmitEditing={handleJoin}
        editable={!isLoading}
        accessibilityLabel="Room code input"
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.joinButton, isDisabled && styles.disabled]}
        onPress={handleJoin}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel="Join room"
      >
        {isLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.joinButtonText}>Join Room</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingTop: 60, gap: 16 },
  backButton: { marginBottom: 8 },
  backText: { color: '#6c63ff', fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  subtitle: { fontSize: 16, color: '#aaaaaa', marginBottom: 8 },
  input: {
    backgroundColor: '#2a2a40', borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 24, fontWeight: '700', color: '#ffffff',
    textAlign: 'center', letterSpacing: 6,
    borderWidth: 1, borderColor: '#3a3a55',
  },
  inputError: { borderColor: '#ff6b6b' },
  errorText: { color: '#ff6b6b', fontSize: 14 },
  joinButton: {
    backgroundColor: '#6c63ff', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  disabled: { opacity: 0.5 },
  joinButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
})
