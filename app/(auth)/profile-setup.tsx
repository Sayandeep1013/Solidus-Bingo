/**
 * app/(auth)/profile-setup.tsx — Profile_Setup_Screen
 *
 * Shown to first-time users after Google sign-in when profile.username is NULL.
 * Validates username client-side first (immediate feedback), then calls the
 * profile-service Edge Function for authoritative server-side validation.
 *
 * From bingo-authentication spec §Req 6–7:
 *   - Input + Confirm button
 *   - Loading state on submit (button disabled)
 *   - Error message stays visible with input field
 *   - On success → navigate to /(app)
 *
 * Validation priority order (spec req 7.4):
 *   1. CHARACTER validity → USERNAME_INVALID_CHARS
 *   2. LENGTH → USERNAME_TOO_SHORT / USERNAME_TOO_LONG
 *   3. UNIQUENESS → USERNAME_TAKEN (server only)
 */
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import type { UsernameErrorCode } from '@/types/auth'

const USERNAME_CHARS_RE = /^[A-Za-z0-9_-]+$/

const ERROR_MESSAGES: Record<UsernameErrorCode, string> = {
  USERNAME_INVALID_CHARS:
    'Only letters, numbers, underscores, and hyphens are allowed.',
  USERNAME_TOO_SHORT: 'Username must be at least 1 character.',
  USERNAME_TOO_LONG: 'Username must be 30 characters or fewer.',
  USERNAME_TAKEN: 'That username is already taken. Please choose another.',
}

/** Client-side validation mirrors server validation for immediate feedback */
function validateUsernameLocally(value: string): UsernameErrorCode | null {
  if (!USERNAME_CHARS_RE.test(value)) return 'USERNAME_INVALID_CHARS'
  if (value.length < 1) return 'USERNAME_TOO_SHORT'
  if (value.length > 30) return 'USERNAME_TOO_LONG'
  return null
}

export default function ProfileSetupScreen() {
  const { session, profile, isLoading: authLoading, updateProfile } = useAuth()

  const [username, setUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already has username → send to app
  if (session && profile?.username) {
    return <Redirect href="/(app)" />
  }

  // No session at all → send to login
  if (!session && !authLoading) {
    return <Redirect href="/(auth)/login" />
  }

  const handleSubmit = async () => {
    const trimmed = username.trim()
    setError(null)

    // 1. Client-side validation first (immediate feedback)
    const localError = validateUsernameLocally(trimmed)
    if (localError) {
      setError(ERROR_MESSAGES[localError])
      return
    }

    setIsSubmitting(true)
    try {
      // 2. Server-side validation + persistence
      const serverError = await updateProfile(trimmed)
      if (serverError) {
        setError(ERROR_MESSAGES[serverError])
      }
      // On success, AuthContext reloads profile → profile.username is set
      // → this screen will redirect to /(app) via the guard above
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error('[ProfileSetupScreen] updateProfile error:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isDisabled = isSubmitting || !username.trim()

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Choose a username</Text>
        <Text style={styles.subtitle}>
          This is how other players will see you.
          {'\n'}Letters, numbers, underscores, and hyphens only.
        </Text>

        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={username}
          onChangeText={(t) => {
            setUsername(t)
            setError(null)
          }}
          placeholder="e.g. BingoKing_99"
          placeholderTextColor="#555555"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          maxLength={30}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          editable={!isSubmitting}
          accessibilityLabel="Username input"
        />

        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.button, isDisabled && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isDisabled}
          accessibilityRole="button"
          accessibilityLabel="Confirm username"
          accessibilityState={{ disabled: isDisabled }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#1a1a2e" size="small" />
          ) : (
            <Text style={styles.buttonText}>Confirm</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2a2a40',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#3a3a55',
  },
  inputError: {
    borderColor: '#ff6b6b',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
  },
  button: {
    backgroundColor: '#6c63ff',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
})
