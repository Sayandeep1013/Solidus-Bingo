/**
 * app/(app)/join-room.tsx — JoinRoomScreen
 *
 * Code input (uppercase, 6 chars) + Join button.
 * Normalises to uppercase before sending to Edge Function.
 */
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Text, TextInput, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { useRoomStore } from '@/store/roomStore'
import { colors, fonts, spacing } from '@/theme'
import { PageHeader, PaperBackground, NewsButton } from '@/components/news'

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

  const isDisabled = isLoading || code.trim().length !== 6

  return (
    <PaperBackground>
      <PageHeader title="Join a Room" backLabel="Back" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={styles.subtitle}>Enter the 6-character room code.</Text>

        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={code}
          onChangeText={(t) => { setCode(t.toUpperCase()); setError(null) }}
          placeholder="e.g. ABC3DX"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={handleJoin}
          editable={!isLoading}
          accessibilityLabel="Room code input"
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <NewsButton
          label="Join Room"
          onPress={handleJoin}
          variant="accent"
          disabled={isDisabled}
          loading={isLoading}
        />
      </KeyboardAvoidingView>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: spacing.md },
  subtitle: { fontFamily: fonts.body, fontSize: 16, color: colors.inkFaded, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.paperMuted,
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: fonts.headlineBold, fontSize: 24, color: colors.ink,
    textAlign: 'center', letterSpacing: 6,
    borderWidth: 1, borderColor: colors.rule,
  },
  inputError: { borderColor: colors.accent },
  errorText: { fontFamily: fonts.body, color: colors.accent, fontSize: 14 },
})
