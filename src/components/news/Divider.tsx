import { View, StyleSheet, type ViewStyle } from 'react-native'
import { colors } from '@/theme'

/** A hairline rule — the workhorse of a newspaper layout. `double` gives the
 * heavier two-line rule papers use between major sections (e.g. under a
 * masthead). `thick` swaps the hairline for a solid printed bar, for the
 * heavy rule that brackets a nameplate. `short` centres a stub rule instead of
 * running edge to edge — the ornamental break a paper puts above its colophon,
 * where a full-width rule would read as another section boundary. */
export function Divider({
  double = false,
  thick = false,
  short = false,
  style,
}: {
  double?: boolean
  thick?: boolean
  short?: boolean
  style?: ViewStyle
}) {
  const lineStyle = [thick ? styles.thickLine : styles.line, short && styles.short]
  if (!double) return <View style={[lineStyle, style]} />
  return (
    <View style={[short && styles.shortWrap, style]}>
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
  // Long enough to read as the same rule as the section ones under PRIVATE
  // ROOM / PRACTICE / STANDINGS, just centred and inset instead of running the
  // full column. At 88px it was a short fat dash and sat oddly against them.
  short: { width: 220, alignSelf: 'center' },
  shortWrap: { alignSelf: 'center' },
})
