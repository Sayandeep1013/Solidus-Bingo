import { View, StyleSheet, type ViewStyle } from 'react-native'
import { colors } from '@/theme'

/** A hairline rule — the workhorse of a newspaper layout. `double` gives the
 * heavier two-line rule papers use between major sections (e.g. under a
 * masthead). `thick` swaps the hairline for a solid printed bar, for the
 * heavy rule that brackets a nameplate. */
export function Divider({
  double = false,
  thick = false,
  style,
}: {
  double?: boolean
  thick?: boolean
  style?: ViewStyle
}) {
  const lineStyle = thick ? styles.thickLine : styles.line
  if (!double) return <View style={[lineStyle, style]} />
  return (
    <View style={style}>
      <View style={lineStyle} />
      <View style={[lineStyle, thick ? styles.doubleGapThick : styles.doubleGap]} />
    </View>
  )
}

const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.rule },
  thickLine: { height: 3, backgroundColor: colors.rule },
  doubleGap: { marginTop: 3 },
  doubleGapThick: { marginTop: 4 },
})
