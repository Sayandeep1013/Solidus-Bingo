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
import { useFonts } from 'expo-font'
import { Anton_400Regular } from '@expo-google-fonts/anton'
import {
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display'
import {
  PTSerif_400Regular,
  PTSerif_400Regular_Italic,
  PTSerif_700Bold,
} from '@expo-google-fonts/pt-serif'
import { AuthProvider } from '@/context/AuthContext'
import { handleDeepLink } from '@/lib/auth'

// Hold the native splash visible until fonts + AuthContext's session
// restoration both finish. AuthProvider isn't mounted at all until fonts
// are ready, so AuthContext's own hideAsync() call (once auth resolves)
// can never fire before the newsprint typeface is available to render.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    PlayfairDisplay_900Black,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    PTSerif_400Regular,
    PTSerif_400Regular_Italic,
    PTSerif_700Bold,
  })

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

  if (!fontsLoaded) return null

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
