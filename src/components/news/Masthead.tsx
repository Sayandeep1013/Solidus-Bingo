import { Text, View, StyleSheet } from 'react-native'
import { colors, fonts, KICKER_LETTER_SPACING } from '@/theme'
import { Divider } from './Divider'

/**
 * The paper's nameplate — a blackletter title bracketed by thick double
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
      {/* Set as written, never uppercased: blackletter capitals are ornamental
          letterforms, and a word made entirely of them stops being readable. */}
      <Text style={styles.title}>{title}</Text>
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
    fontFamily: fonts.nameplate,
    // Larger than the old condensed grotesk at 42: blackletter carries far
    // more of its weight in ornament, so it reads smaller at the same size.
    fontSize: 52,
    // No tracking. Blackletter is drawn to sit tight — spacing it out breaks
    // the woven texture that makes it read as a nameplate at all.
    letterSpacing: 0,
    color: colors.ink,
    textAlign: 'center',
    // Extra room below: the face has deep descenders that would otherwise
    // collide with the rule beneath it.
    marginTop: 8,
    marginBottom: 14,
    // Ascenders/descenders need more line box than the default gives them,
    // or Android clips the tops of the capitals.
    lineHeight: 66,
    includeFontPadding: false,
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
