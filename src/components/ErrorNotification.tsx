/**
 * src/components/ErrorNotification.tsx
 *
 * Non-blocking, auto-dismissing notification for Edge Function errors
 * and auth errors. Displayed at the bottom of the screen.
 *
 * Spec: bingo-game-mechanics §Req 9, bingo-authentication §Req 12
 * - Never shows raw error objects or stack traces (plain-language only)
 * - Auto-dismisses after 4 seconds
 */
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, fonts, radius } from '../theme'

interface ErrorNotificationProps {
  message: string | null
  onDismiss: () => void
  /** How long before auto-dismiss in ms. Default 4000. */
  autoDismissMs?: number
}

export function ErrorNotification({
  message,
  onDismiss,
  autoDismissMs = 4000,
}: ErrorNotificationProps) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!message) {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start()
      return
    }

    // Fade in
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start()

    // Auto-dismiss
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => onDismiss()
      )
    }, autoDismissMs)

    return () => clearTimeout(timer)
    // Intentionally re-runs only on `message` change — `onDismiss` is
    // typically passed as a fresh inline closure by callers, and including
    // it (or autoDismissMs) here would restart the auto-dismiss timer on
    // every parent re-render instead of only when a new message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])

  if (!message) return null

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <Text style={styles.message} numberOfLines={3}>
        {message}
      </Text>
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
      >
        <Ionicons name="close" size={18} color={colors.paper} />
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: colors.accent,
    borderRadius: radius.hairline,
    borderWidth: 1,
    borderColor: colors.accentDark,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  message: {
    flex: 1,
    fontFamily: fonts.body,
    color: colors.paper,
    fontSize: 14,
    lineHeight: 20,
  },
  dismiss: {
    paddingLeft: 12,
    paddingVertical: 4,
  },
})
