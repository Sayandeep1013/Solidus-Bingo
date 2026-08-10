/**
 * app/(app)/_layout.tsx
 *
 * Auth guard for all authenticated screens.
 * Also hooks logout → resetAllStores().
 */
import { useEffect } from 'react'
import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { resetAllStores } from '@/store'
import { useRoomStore } from '@/store/roomStore'
import { useGameStore } from '@/store/gameStore'
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel'

export default function AppLayout() {
  const { session, profile, isLoading } = useAuth()

  // Reset all stores when user logs out.
  // Guard with !isLoading to avoid firing on first mount when session is still null
  // (before the INITIAL_SESSION event has been processed).
  useEffect(() => {
    if (!session && !isLoading) {
      resetAllStores()
    }
  }, [session, isLoading])

  // Bug fix: the Realtime channel used to be opened inside LobbyScreen only,
  // so navigating from the lobby to the game screen unmounted it — tearing
  // down the only channel at the exact moment gameplay begins, and no
  // screen ever received another Postgres Changes event. Owning it here,
  // at the layout that wraps every screen in the authenticated app, means
  // it survives every in-app navigation and only tears down when roomId
  // clears (leave-room / room closed).
  const roomId = useRoomStore((s) => s.roomId)
  const gameId = useGameStore((s) => s.gameId)
  useRealtimeChannel(roomId, gameId)

  // Covered by the root layout's <AppSplash /> for exactly as long as this is
  // true, so nothing is ever visibly blank here.
  if (isLoading) return null

  if (!session) return <Redirect href="/(auth)/login" />
  if (!profile?.username) return <Redirect href="/(auth)/profile-setup" />

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-room" />
      <Stack.Screen name="join-room" />
      <Stack.Screen name="lobby/[roomId]" />
      <Stack.Screen name="game/[gameId]" />
      <Stack.Screen name="result/[gameId]" />
      <Stack.Screen name="bot-setup" />
      <Stack.Screen name="bot-game" />
      <Stack.Screen name="bot-result" />
      <Stack.Screen name="ranked-play" />
      <Stack.Screen name="leaderboard" />
    </Stack>
  )
}
