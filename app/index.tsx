/**
 * app/index.tsx — Root index redirect
 *
 * Routes the user based on their auth state:
 *   - Loading → <AppSplash /> covers this screen from the root layout
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
    // <AppSplash /> is drawn over this by the root layout; the matching paper
    // fill just means nothing flashes through during its fade-out.
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
