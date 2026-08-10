/**
 * app/(app)/bot-setup.tsx — BotSetupScreen
 *
 * Picks total player count (2-4, i.e. 1-3 bots) then starts a fully local
 * Bot_Session — no network request, works offline.
 *
 * Spec: .kiro/specs/bingo-play-vs-bot/requirements.md Req 1
 */
import { useState } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useBotGameStore } from '@/store/botGameStore'
import { colors, fonts, spacing } from '@/theme'
import { PageHeader, PaperBackground, NewsButton, CapacityPicker } from '@/components/news'

export default function BotSetupScreen() {
  const [totalPlayers, setTotalPlayers] = useState<2 | 3 | 4>(2)
  const startSession = useBotGameStore((s) => s.startSession)

  const handleStart = () => {
    startSession(totalPlayers)
    router.replace('/(app)/bot-game')
  }

  return (
    <PaperBackground>
      <PageHeader title="Play vs Bot" backLabel="Back" />
      <View style={styles.container}>
        <Text style={styles.subtitle}>How many total players (you + bots)?</Text>

        <CapacityPicker
          value={totalPlayers}
          onChange={setTotalPlayers}
          labelFor={(n) => `${n - 1} bot${n - 1 === 1 ? '' : 's'}`}
        />

        <Text style={styles.note}>
          Practice mode — plays entirely on this device and never affects the leaderboard.
        </Text>

        <NewsButton label="Start" onPress={handleStart} variant="accent" accessibilityLabel="Start bot game" />
      </View>
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, gap: spacing.lg },
  subtitle: { fontFamily: fonts.body, fontSize: 16, color: colors.inkFaded },
  note: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.inkFaded, textAlign: 'center' },
})
