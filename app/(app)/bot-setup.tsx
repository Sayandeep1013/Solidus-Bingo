/**
 * app/(app)/bot-setup.tsx — BotSetupScreen
 *
 * Picks total player count (2-4, i.e. 1-3 bots) then starts a fully local
 * Bot_Session — no network request, works offline.
 *
 * Spec: .kiro/specs/bingo-play-vs-bot/requirements.md Req 1
 */
import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useBotGameStore } from '@/store/botGameStore'

const TOTAL_PLAYERS = [2, 3, 4] as const

export default function BotSetupScreen() {
  const [totalPlayers, setTotalPlayers] = useState<2 | 3 | 4>(2)
  const startSession = useBotGameStore((s) => s.startSession)

  const handleStart = () => {
    startSession(totalPlayers)
    router.replace('/(app)/bot-game')
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Play vs Bot</Text>
      <Text style={styles.subtitle}>How many total players (you + bots)?</Text>

      <View style={styles.optionRow}>
        {TOTAL_PLAYERS.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.option, totalPlayers === n && styles.optionSelected]}
            onPress={() => setTotalPlayers(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: totalPlayers === n }}
            accessibilityLabel={`${n} players`}
          >
            <Text style={[styles.optionText, totalPlayers === n && styles.optionTextSelected]}>
              {n}
            </Text>
            <Text style={styles.optionLabel}>{n - 1} bot{n - 1 === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.note}>
        Practice mode — plays entirely on this device and never affects the leaderboard.
      </Text>

      <TouchableOpacity
        style={styles.startButton}
        onPress={handleStart}
        accessibilityRole="button"
        accessibilityLabel="Start bot game"
      >
        <Text style={styles.startButtonText}>Start</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingTop: 60, gap: 20 },
  backButton: { marginBottom: 8 },
  backText: { color: '#6c63ff', fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  subtitle: { fontSize: 16, color: '#aaaaaa' },
  optionRow: { flexDirection: 'row', gap: 12 },
  option: {
    flex: 1, paddingVertical: 20, borderRadius: 12,
    backgroundColor: '#2a2a40', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  optionSelected: { borderColor: '#6c63ff', backgroundColor: '#2a2a50' },
  optionText: { fontSize: 32, fontWeight: 'bold', color: '#888888' },
  optionTextSelected: { color: '#ffffff' },
  optionLabel: { fontSize: 12, color: '#666666', marginTop: 4 },
  note: { fontSize: 13, color: '#666666', textAlign: 'center' },
  startButton: {
    backgroundColor: '#6c63ff', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  startButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
})
