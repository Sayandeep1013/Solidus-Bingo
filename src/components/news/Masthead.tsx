import { Text, View, StyleSheet } from 'react-native'
import { colors, fonts, KICKER_LETTER_SPACING } from '@/theme'
import { Divider } from './Divider'

/**
 * The paper's nameplate — a heavy Anton title bracketed by thick double
 * rules (the way a real front page brackets its own name), with the
 * dateline/edition kicker and an italic tagline set below, closed off by a
 * thin rule before the page's lead story. Used on Login and Home; every
 * other screen uses PageHeader instead.
 */
export function Masthead({
  title,
  tagline,
  kicker,
}: {
  title: string
  tagline?: string
  kicker?: string
}) {
  return (
    <View style={styles.container}>
      <Divider thick double style={styles.topRule} />
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      <Divider thick double style={styles.midRule} />
      {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
      {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
      <Divider style={styles.bottomRule} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  topRule: { width: '100%' },
  title: {
    fontFamily: fonts.masthead,
    fontSize: 42,
    letterSpacing: 1,
    color: colors.ink,
    textAlign: 'center',
    marginVertical: 10,
  },
  midRule: { width: '100%' },
  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: KICKER_LETTER_SPACING,
    color: colors.inkFaded,
    marginTop: 8,
  },
  tagline: {
    fontFamily: fonts.bodyItalic,
    fontSize: 14,
    color: colors.inkFaded,
    marginTop: 4,
  },
  bottomRule: { width: '100%', marginTop: 10 },
})
