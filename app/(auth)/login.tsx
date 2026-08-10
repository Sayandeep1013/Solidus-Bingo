/**
 * app/(auth)/login.tsx — Login_Screen
 *
 * Presents the "Continue with Google" button.
 * Handles all auth error states from the spec:
 *   - GOOGLE_AUTH_CANCELLED → silent (no message)
 *   - GOOGLE_AUTH_FAILED    → non-blocking error message
 *   - NETWORK_ERROR         → connection error message
 *   - SESSION_EXPIRED       → session expired message
 *
 * From bingo-authentication spec §Req 4:
 *   - Button disabled while loading to prevent duplicate taps
 *   - No error shown on cancel
 */
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { useAuth } from '@/context/AuthContext'

const ERROR_MESSAGES: Record<string, string> = {
  GOOGLE_AUTH_FAILED:
    'Sign-in failed. Please try again.',
  NETWORK_ERROR:
    'Could not connect. Check your internet connection and try again.',
  SESSION_EXPIRED:
    'Your session has expired. Please sign in again.',
  PROFILE_LOAD_FAILED:
    'Your profile could not be loaded. Please try again.',
}

export default function LoginScreen() {
  const { session, profile, isLoading, authError, signIn } = useAuth()

  // Should not normally render if already signed in — guard anyway
  if (session && profile?.username) {
    return <Redirect href="/(app)" />
  }

  // Signed in but no username → go to profile setup
  if (session && !profile?.username && !isLoading) {
    return <Redirect href="/(auth)/profile-setup" />
  }

  const errorMessage =
    authError && authError !== 'GOOGLE_AUTH_CANCELLED'
      ? ERROR_MESSAGES[authError] ?? 'An unexpected error occurred.'
      : null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Solidus Bingo</Text>
        <Text style={styles.subtitle}>Real-time multiplayer bingo</Text>
      </View>

      <View style={styles.body}>
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={signIn}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color="#1a1a2e" size="small" />
          ) : (
            <Text style={styles.buttonText}>Continue with Google</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
  },
  body: {
    gap: 16,
  },
  errorBanner: {
    backgroundColor: '#3d1a1a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#7a2020',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: '600',
  },
})
