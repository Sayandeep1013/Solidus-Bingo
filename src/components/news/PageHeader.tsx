import { Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { colors, fonts } from '@/theme'
import { Divider } from './Divider'

/**
 * Standard sub-screen header: a back chevron + title, always safe-area
 * aware (every "Leave"/"Back" control in this app funnels through here
 * specifically so the status-bar-overlap bug found during device testing —
 * a bare `paddingTop: 16` header rendering underneath the status bar and
 * being untappable — can't recur on a screen added later).
 */
export function PageHeader({
  title,
  onBack,
  backLabel = 'Back',
}: {
  title?: string
  onBack?: () => void
  backLabel?: string
}) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity
        style={styles.backRow}
        onPress={onBack ?? (() => router.back())}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <Ionicons name="chevron-back" size={18} color={colors.accent} />
        <Text style={styles.backText}>{backLabel}</Text>
      </TouchableOpacity>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Divider style={styles.rule} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  title: { fontFamily: fonts.headlineBold, fontSize: 26, color: colors.ink },
  rule: { marginTop: 4 },
})
