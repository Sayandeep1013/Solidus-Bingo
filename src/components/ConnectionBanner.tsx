/**
 * src/components/ConnectionBanner.tsx
 *
 * Non-blocking reconnection banner shown during RECONNECTING state.
 * Renders nothing when CONNECTED.
 * Shows full-screen error UI when DISCONNECTED.
 *
 * Spec: bingo-realtime §Req 9, bingo-state-management §Req 9
 */
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useConnectionStore } from '../store/connectionStore'

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
        <ActivityIndicator color="#cc99ff" size="small" />
        <Text style={styles.reconnectingText}>
          Reconnecting{reconnectAttempts > 1 ? ` (attempt ${reconnectAttempts})` : '…'}
        </Text>
        {snapshotError ? (
          <Text style={styles.snapshotErrorText}>⚠ Sync error</Text>
        ) : null}
      </View>
    )
  }

  // ── DISCONNECTED — full-screen blocking overlay ───────────────────────────
  return (
    <View style={styles.disconnectedOverlay} accessibilityLiveRegion="assertive">
      <View style={styles.disconnectedCard}>
        <Text style={styles.disconnectedIcon}>📡</Text>
        <Text style={styles.disconnectedTitle}>Connection Lost</Text>
        <Text style={styles.disconnectedSubtitle}>
          Could not reconnect after 2 minutes.{'\n'}
          Your game state is preserved — you can retry.
        </Text>

        {snapshotError ? (
          <View style={styles.snapshotErrorBox}>
            <Text style={styles.snapshotErrorDetail}>
              ⚠ Could not sync game state: {snapshotError}
            </Text>
          </View>
        ) : null}

        <View style={styles.disconnectedActions}>
          {onRetry ? (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          ) : null}

          {onLeave ? (
            <TouchableOpacity
              style={styles.leaveButton}
              onPress={onLeave}
              accessibilityRole="button"
              accessibilityLabel="Leave game"
            >
              <Text style={styles.leaveButtonText}>Leave Game</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Reconnecting banner — non-blocking, sits at top
  reconnectingBanner: {
    backgroundColor: '#2a1a3a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  reconnectingText: {
    color: '#cc99ff',
    fontSize: 13,
  },
  snapshotErrorText: {
    color: '#ffaa44',
    fontSize: 12,
    marginLeft: 4,
  },

  // Disconnected — full-screen blocking overlay
  disconnectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    paddingHorizontal: 24,
  },
  disconnectedCard: {
    backgroundColor: '#1e1e30',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#3a3a55',
  },
  disconnectedIcon: { fontSize: 48 },
  disconnectedTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  disconnectedSubtitle: {
    fontSize: 14,
    color: '#aaaaaa',
    textAlign: 'center',
    lineHeight: 20,
  },
  snapshotErrorBox: {
    backgroundColor: '#2a1a00',
    borderRadius: 8,
    padding: 10,
    width: '100%',
  },
  snapshotErrorDetail: {
    color: '#ffaa44',
    fontSize: 12,
    textAlign: 'center',
  },
  disconnectedActions: {
    gap: 10,
    width: '100%',
    marginTop: 8,
  },
  retryButton: {
    backgroundColor: '#6c63ff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  leaveButton: {
    backgroundColor: '#2a2a40',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a55',
  },
  leaveButtonText: {
    color: '#cc4444',
    fontSize: 15,
  },
})
