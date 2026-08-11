/**
 * src/components/ConnectionBanner.tsx
 *
 * Non-blocking reconnection banner shown during RECONNECTING state.
 * Renders nothing when CONNECTED.
 * Shows full-screen error UI when DISCONNECTED.
 *
 * Spec: bingo-realtime §Req 9, bingo-state-management §Req 9
 */
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useConnectionStore } from '../store/connectionStore'
import { colors, fonts, spacing } from '../theme'
import { NewsButton, NewsCard } from './news'

interface ConnectionBannerProps {
  /** Called when user taps "Retry" on the DISCONNECTED screen */
  onRetry?: () => void
  /** Called when user taps "Leave Game" on the DISCONNECTED screen */
  onLeave?: () => void
}

export function ConnectionBanner({ onRetry, onLeave }: ConnectionBannerProps) {
  const connectionState = useConnectionStore((s) => s.connectionState)
  const reconnectAttempts = useConnectionStore((s) => s.reconnectAttempts)
  const snapshotError = useConnectionStore((s) => s.snapshotError)

  if (connectionState === 'CONNECTED') return null

  // ── RECONNECTING — non-blocking top banner ────────────────────────────────
  if (connectionState === 'RECONNECTING') {
    return (
      <View style={styles.reconnectingBanner} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.paper} size="small" />
        <Text style={styles.reconnectingText}>
          Reconnecting{reconnectAttempts > 1 ? ` (attempt ${reconnectAttempts})` : '…'}
        </Text>
        {snapshotError ? (
          <View style={styles.snapshotErrorRow}>
            <Ionicons name="warning-outline" size={12} color={colors.paper} />
            <Text style={styles.snapshotErrorText}>Sync error</Text>
          </View>
        ) : null}
      </View>
    )
  }

  // ── DISCONNECTED — full-screen blocking overlay ───────────────────────────
  return (
    <View style={styles.disconnectedOverlay} accessibilityLiveRegion="assertive">
      <NewsCard style={styles.disconnectedCard}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.accent} />
        <Text style={styles.disconnectedTitle}>Connection Lost</Text>
        <Text style={styles.disconnectedSubtitle}>
          Could not reconnect after 2 minutes.{'\n'}
          Your game state is preserved — you can retry.
        </Text>

        {snapshotError ? (
          <View style={styles.snapshotErrorBox}>
            <Text style={styles.snapshotErrorDetail}>
              Could not sync game state: {snapshotError}
            </Text>
          </View>
        ) : null}

        <View style={styles.disconnectedActions}>
          {onRetry ? <NewsButton label="Retry" onPress={onRetry} variant="accent" accessibilityLabel="Retry connection" /> : null}
          {onLeave ? <NewsButton label="Leave Game" onPress={onLeave} variant="plain" accessibilityLabel="Leave game" /> : null}
        </View>
      </NewsCard>
    </View>
  )
}

const styles = StyleSheet.create({
  // Reconnecting banner — non-blocking, sits at top
  reconnectingBanner: {
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  reconnectingText: {
    fontFamily: fonts.bodyBold,
    color: colors.paper,
    fontSize: 13,
  },
  snapshotErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 4 },
  snapshotErrorText: {
    fontFamily: fonts.body,
    color: colors.paper,
    fontSize: 12,
  },

  // Disconnected — full-screen blocking overlay
  disconnectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    paddingHorizontal: 24,
  },
  disconnectedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    padding: 32,
  },
  disconnectedTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  disconnectedSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkFaded,
    textAlign: 'center',
    lineHeight: 20,
  },
  snapshotErrorBox: {
    backgroundColor: colors.paperMuted,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: 10,
    width: '100%',
  },
  snapshotErrorDetail: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontSize: 12,
    textAlign: 'center',
  },
  disconnectedActions: {
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.xs,
  },
})
