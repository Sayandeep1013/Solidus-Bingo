/**
 * app/(auth)/_layout.tsx
 *
 * Route group for unauthenticated screens: login, profile-setup.
 * If the user already has a session + username, redirect to the app.
 */
import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@/context/AuthContext'

export default function AuthLayout() {
  const { session, profile, isLoading } = useAuth()

  // While restoring the session the root layout's <AppSplash /> covers this.
  if (isLoading) return null

  // Fully authenticated with username → go to app
  if (session && profile?.username) {
    return <Redirect href="/(app)" />
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="profile-setup" />
    </Stack>
  )
}
