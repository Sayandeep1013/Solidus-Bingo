/**
 * src/components/news/UpdateRequired.tsx
 *
 * What a retired build shows instead of the app. Rendered in place of the
 * navigator, not over it, so there is nothing behind to reach: the point of the
 * gate is that this version must stop talking to the backend, and a dismissible
 * overlay with a live app underneath would not achieve that.
 *
 * Set as a front page rather than an error dialog — a late edition recalling
 * the last one, which is the honest description of what has happened.
 */
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fonts, spacing, KICKER_LETTER_SPACING } from '@/theme'
import { APP_VERSION } from '@/lib/appUpdate'
import { Divider } from './Divider'
import { Masthead } from './Masthead'
import { NewsButton } from './NewsButton'
import { PaperBackground } from './PaperBackground'

const GENERIC_MESSAGE =
  'This edition has been recalled. Download the current one to keep playing — ' +
  'your account, results and standings are all unaffected.'

export function UpdateRequired({
  downloadUrl,
  latestVersion,
  message,
}: {
  downloadUrl: string
  latestVersion: string | null
  message: string | null
}) {
  const insets = useSafeAreaInsets()

  return (
    <PaperBackground>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl },
        ]}
      >
        <Masthead
          kicker="Late Edition"
          title="Solidus Bingo"
          tagline="An update is required"
        />

        <View style={styles.body}>
          <Text style={styles.kicker}>Stop Press</Text>
          <Text style={styles.headline}>This version is out of date</Text>
          <Text style={styles.copy}>{message ?? GENERIC_MESSAGE}</Text>

          <Divider style={styles.rule} />

          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>You have</Text>
            <Text style={styles.versionValue}>{APP_VERSION ?? 'Unknown'}</Text>
          </View>
          {latestVersion ? (
            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Current</Text>
              <Text style={styles.versionValue}>{latestVersion}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <NewsButton
            label="Download the Current Edition"
            variant="accent"
            onPress={() => Linking.openURL(downloadUrl)}
            accessibilityLabel="Download the current version of Solidus Bingo"
          />
          {/* Opened in the system browser rather than an in-app one so the
              download lands in Downloads, where Android's installer can find
              it — an in-app browser session dies with this screen. */}
          <Text style={styles.footnote}>
            Opens in your browser. Install over the top of this one; nothing is lost.
          </Text>
        </View>
      </ScrollView>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: spacing.xl, gap: spacing.xl },
  body: { gap: spacing.sm },
  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: KICKER_LETTER_SPACING,
    color: colors.accent,
  },
  headline: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  copy: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkFaded },
  rule: { marginVertical: spacing.sm },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  versionLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaded },
  versionValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  actions: { gap: spacing.sm, marginTop: 'auto' },
  footnote: {
    fontFamily: fonts.bodyItalic,
    fontSize: 12,
    color: colors.inkFaint,
    textAlign: 'center',
  },
})
