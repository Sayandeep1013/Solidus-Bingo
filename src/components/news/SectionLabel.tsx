import { Text, View, StyleSheet } from 'react-native'
import { colors, fonts, KICKER_LETTER_SPACING } from '@/theme'
import { Divider } from './Divider'

/** A small-caps-style "kicker" section label (e.g. PRIVATE ROOM, PRACTICE)
 * with a hairline rule underneath, the way a newspaper labels a section. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{children.toUpperCase()}</Text>
      <Divider style={styles.rule} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded,
  },
  rule: { marginTop: 2 },
})
