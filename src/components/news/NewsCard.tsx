import type { ReactNode } from 'react'
import { View, StyleSheet, type ViewStyle } from 'react-native'
import { colors, radius } from '@/theme'

/** A bordered box, like a clipped newspaper article — the replacement for
 * the old rounded, colour-filled "card" pattern. */
export function NewsCard({
  children,
  selected = false,
  muted = false,
  style,
}: {
  children: ReactNode
  selected?: boolean
  muted?: boolean
  style?: ViewStyle
}) {
  return (
    <View
      style={[
        styles.base,
        muted && styles.muted,
        selected && styles.selected,
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.hairline,
    backgroundColor: colors.paper,
    padding: 16,
  },
  muted: { backgroundColor: colors.paperMuted },
  selected: { borderWidth: 2, borderColor: colors.accent },
})
