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
import { useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { signInWithTestAccount } from '@/lib/auth'
import { TEST_LOGIN_ENABLED, TEST_ACCOUNTS, TEST_ACCOUNT_PASSWORD } from '@/lib/testAccounts'
import { colors, fonts, spacing, KICKER_LETTER_SPACING } from '@/theme'
import { Masthead, PaperBackground, NewsButton, Divider } from '@/components/news'

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
  const [testLoginError, setTestLoginError] = useState<string | null>(null)
  const [testLoginBusy, setTestLoginBusy] = useState<string | null>(null)

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

  const handleTestLogin = async (email: string) => {
    setTestLoginError(null)
    setTestLoginBusy(email)
    try {
      await signInWithTestAccount(email, TEST_ACCOUNT_PASSWORD)
    } catch {
      setTestLoginError('Test login failed')
    } finally {
      setTestLoginBusy(null)
    }
  }

  return (
    <PaperBackground>
      <View style={styles.container}>
        <Masthead
          kicker="Vol. I · No. 1"
          title="Solidus Bingo"
          tagline="Real-Time Multiplayer, Every Edition"
        />

        <View style={styles.body}>
          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.accent} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <NewsButton
            label="Continue with Google"
            onPress={signIn}
            variant="primary"
            icon="logo-google"
            IconComponent={Ionicons}
            loading={isLoading}
          />

          {TEST_LOGIN_ENABLED && (
            <View style={styles.testLoginBox}>
              <Divider />
              <Text style={styles.testLoginLabel}>Dev Test Login — QA Only</Text>
              {testLoginError ? <Text style={styles.errorText}>{testLoginError}</Text> : null}
              <View style={styles.testLoginRow}>
                {TEST_ACCOUNTS.map((acct) => (
                  <TouchableOpacity
                    key={acct.email}
                    style={styles.testLoginButton}
                    onPress={() => handleTestLogin(acct.email)}
                    disabled={testLoginBusy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Test Login ${acct.username}`}
                  >
                    {testLoginBusy === acct.email ? (
                      <ActivityIndicator color={colors.ink} size="small" />
                    ) : (
                      <Text style={styles.testLoginButtonText}>{acct.username}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  body: {
    gap: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.paperMuted,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: 12,
  },
  errorText: {
    color: colors.accent,
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: 'center',
    flex: 1,
  },
  testLoginBox: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  testLoginLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  testLoginRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  testLoginButton: {
    backgroundColor: colors.paperMuted,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 70,
    alignItems: 'center',
  },
  testLoginButtonText: {
    fontFamily: fonts.bodyBold,
    color: colors.ink,
    fontSize: 13,
  },
})
