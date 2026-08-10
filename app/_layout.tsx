/**
 * app/_layout.tsx — Root layout
 *
 * Responsibilities:
 * 1. Register deep link listener BEFORE navigation renders (spec req 3.4)
 * 2. Wrap the app in AuthProvider
 * 3. Handle cold-start deep link (getInitialURL)
 */
import 'react-native-url-polyfill/auto'
import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as Linking from 'expo-linking'
import * as SplashScreen from 'expo-splash-screen'
import { AuthProvider } from '@/context/AuthContext'
import { handleDeepLink } from '@/lib/auth'

// Hold the native splash visible until AuthContext finishes session restoration
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  useEffect(() => {
    // Foreground deep links
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url)
    })

    // Cold-start deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url)
    })

    return () => subscription.remove()
  }, [])

  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  )
}

function RootNavigator() {
  // AuthContext hides the splash once isLoading becomes false
  // (AuthContext calls SplashScreen.hideAsync after session check)
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/callback" options={{ animation: 'none' }} />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  )
}
