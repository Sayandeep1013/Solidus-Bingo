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
import { KeyboardAvoidingView, Platform, Text, TextInput, View, StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import type { UsernameErrorCode } from '@/types/auth'
import { colors, fonts, spacing } from '@/theme'
import { PaperBackground, NewsButton, SectionLabel } from '@/components/news'

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
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <SectionLabel>Registration</SectionLabel>
          <Text style={styles.title}>Choose a Byline</Text>
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
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            editable={!isSubmitting}
            accessibilityLabel="Username input"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <NewsButton
            label="Confirm"
            onPress={handleSubmit}
            variant="primary"
            disabled={isDisabled}
            loading={isSubmitting}
            accessibilityLabel="Confirm username"
          />
        </View>
      </KeyboardAvoidingView>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.headlineBold,
    fontSize: 30,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkFaded,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.paperMuted,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  inputError: {
    borderColor: colors.accent,
  },
  errorText: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontSize: 13,
  },
})
