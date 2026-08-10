/**
 * app/_layout.tsx — Root layout
 *
 * Responsibilities:
 * 1. Register deep link listener BEFORE navigation renders (spec req 3.4)
 * 2. Wrap the app in AuthProvider
 * 3. Handle cold-start deep link (getInitialURL)
 */
import 'react-native-url-polyfill/auto'
import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
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
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { handleDeepLink } from '@/lib/auth'
// Imported from the module directly, not the barrel: this is the very first
// thing drawn, and the barrel would pull all thirteen newsprint components (and
// expo-linear-gradient) through module eval before that first frame.
import { AppSplash } from '@/components/news/AppSplash'

// Hold the native splash until <AppSplash /> — which draws the same artwork —
// has been laid out. AppSplash dismisses it itself, on layout, so the two never
// swap through an undrawn frame. See the note at the top of AppSplash.tsx for
// the cold-start trace that motivated this.
SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
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

  // The newsprint typefaces aren't available yet, so the splash artwork (a
  // pre-rendered image) is the only thing that can be drawn correctly here.
  // On a font *failure* we go through anyway and let the system typeface
  // stand in — an ugly home screen beats a splash that never lifts.
  if (!fontsLoaded && !fontError) return <AppSplash />

  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  )
}

function RootNavigator() {
  const { isLoading } = useAuth()

  // isLoading goes true again on sign-in and sign-out; `booted` latches the
  // first time it clears so those never re-raise the nameplate over a screen
  // the user is already looking at.
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    if (!isLoading) setBooted(true)
  }, [isLoading])

  // AppSplash sits *over* the navigator rather than replacing it, so it also
  // covers the beat between auth resolving and index.tsx's <Redirect> landing
  // on a real screen — the stretch that used to show as blank paper.
  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/callback" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      <AppSplash visible={isLoading && !booted} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
