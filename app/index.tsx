/**
 * app/index.tsx — Root index redirect
 *
 * Routes the user based on their auth state:
 *   - Loading → splash screen is still visible (held by SplashScreen.preventAutoHideAsync)
 *   - No session → /(auth)/login
 *   - Session + no username → /(auth)/profile-setup
 *   - Session + username → /(app)
 */
import { Redirect } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme'

export default function Index() {
  const { session, profile, isLoading } = useAuth()

  if (isLoading) {
    // Native splash is still visible — render a blank screen underneath
    return <View style={styles.blank} />
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />
  }

  if (!profile?.username) {
    return <Redirect href="/(auth)/profile-setup" />
  }

  return <Redirect href="/(app)" />
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: colors.paper,
  },
})
