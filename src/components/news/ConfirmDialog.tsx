import { Modal, Text, View, StyleSheet } from 'react-native'
import { colors, fonts, spacing } from '@/theme'
import { NewsButton } from './NewsButton'

/**
 * Themed replacement for React Native's native Alert.alert() — the OS
 * dialog (white background, blue Material buttons) broke the newspaper
 * look badly enough to be worth its own component rather than a one-off
 * fix. Used for every confirm-before-you-lose-something interaction
 * (self-forfeit today; disconnect/vote prompts in later phases).
 */
export function ConfirmDialog({
  visible,
  kicker,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isConfirming = false,
}: {
  visible: boolean
  kicker?: string
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  isConfirming?: boolean
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.cardOuter}>
          <View style={styles.cardInner}>
            {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            <View style={styles.actions}>
              <View style={styles.actionHalf}>
                <NewsButton
                  label={cancelLabel}
                  onPress={onCancel}
                  variant="secondary"
                  accessibilityLabel={cancelLabel}
                />
              </View>
              <View style={styles.actionHalf}>
                <NewsButton
                  label={confirmLabel}
                  onPress={onConfirm}
                  variant="accent"
                  loading={isConfirming}
                  accessibilityLabel={confirmLabel}
                />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: colors.scrim,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  cardOuter: { width: '100%', maxWidth: 420, borderWidth: 2.5, borderColor: colors.ink, padding: 4 },
  cardInner: {
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink,
    padding: spacing.lg, gap: spacing.sm,
  },
  kicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.2, color: colors.accent,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.ink },
  message: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaded, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionHalf: { flex: 1 },
})
