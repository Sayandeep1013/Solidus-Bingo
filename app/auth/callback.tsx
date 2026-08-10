/**
 * app/auth/callback.tsx
 *
 * Landing screen after Google OAuth redirect: bingo://auth/callback#access_token=...
 *
 * By the time expo-router navigates here, signInWithGoogle() has already called
 * createSessionFromUrl(result.url) with the token from WebBrowser.openAuthSessionAsync.
 * That triggers onAuthStateChange(SIGNED_IN) in AuthContext which sets session +
 * loads profile + sets isLoading=false.
 *
 * This screen watches AuthContext and redirects as soon as the state is ready.
 * A hard 8-second timeout prevents infinite loading if something goes wrong.
 */
import { useEffect, useRef } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useAuth } from '@/context/AuthContext'

export default function AuthCallback() {
  const router = useRouter()
  const { session, profile, isLoading } = useAuth()
  const redirected = useRef(false)

  const doRedirect = (path: Href) => {
    if (redirected.current) return
    redirected.current = true
    router.replace(path)
  }

  // Hard timeout — if isLoading never resolves, force navigate after 8s.
  // Intentionally mount-once: doRedirect is a plain closure recreated every
  // render, so depending on it would tear down and restart this timer
  // constantly instead of letting it run once.
  useEffect(() => {
    const timeout = setTimeout(() => {
      console.warn('[AuthCallback] timeout — forcing redirect')
      doRedirect('/')
    }, 8000)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Watch auth state — redirect as soon as it's settled
  useEffect(() => {
    if (isLoading) return

    if (session && profile?.username) {
      doRedirect('/(app)')
    } else if (session && !profile?.username) {
      doRedirect('/(auth)/profile-setup')
    } else {
      // No session — go to login
      doRedirect('/(auth)/login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile, isLoading])

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6c63ff" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
})
