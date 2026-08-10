/**
 * app/(app)/index.tsx — HomeScreen
 *
 * Entry point for authenticated users: ranked matchmaking, private rooms,
 * bot practice, and the leaderboard.
 */
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '@/context/AuthContext'

export default function HomeScreen() {
  const { profile, signOut } = useAuth()

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Solidus Bingo</Text>
        <Text style={styles.greeting}>Hey, {profile?.username ?? 'Player'}</Text>
      </View>

      <TouchableOpacity
        style={styles.rankedButton}
        onPress={() => router.push('/(app)/ranked-play')}
        accessibilityRole="button"
        accessibilityLabel="Play ranked"
      >
        <Text style={styles.rankedButtonTitle}>🏆 Play Ranked</Text>
        <Text style={styles.rankedButtonSubtitle}>Auto-matchmaking · counts toward the leaderboard</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Private Room</Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonHalf]}
            onPress={() => router.push('/(app)/create-room')}
            accessibilityRole="button"
            accessibilityLabel="Create a room"
          >
            <Text style={styles.actionButtonText}>Create Room</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonHalf]}
            onPress={() => router.push('/(app)/join-room')}
            accessibilityRole="button"
            accessibilityLabel="Join a room with a code"
          >
            <Text style={styles.actionButtonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Practice</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => router.push('/(app)/bot-setup')}
          accessibilityRole="button"
          accessibilityLabel="Play against bots"
        >
          <Text style={styles.actionButtonText}>🤖 Play vs Bot</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.leaderboardButton}
        onPress={() => router.push('/(app)/leaderboard')}
        accessibilityRole="button"
        accessibilityLabel="View leaderboard"
      >
        <Text style={styles.leaderboardButtonText}>📊 Leaderboard</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={signOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40, gap: 20 },
  header: { alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 36, fontWeight: 'bold', color: '#ffffff' },
  greeting: { fontSize: 16, color: '#aaaaaa' },
  rankedButton: {
    backgroundColor: '#6c63ff', borderRadius: 14,
    paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center', gap: 4,
  },
  rankedButtonTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  rankedButtonSubtitle: { color: '#e0deff', fontSize: 13 },
  section: { gap: 8 },
  sectionLabel: { color: '#666666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: 10 },
  actionButton: {
    backgroundColor: '#2a2a40', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#3a3a55',
  },
  actionButtonHalf: { flex: 1 },
  actionButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  leaderboardButton: {
    backgroundColor: '#1a2a3a', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#2a4a5a', marginTop: 4,
  },
  leaderboardButtonText: { color: '#66ccff', fontSize: 16, fontWeight: '600' },
  signOutButton: { alignItems: 'center', paddingVertical: 8, marginTop: 8 },
  signOutText: { color: '#555577', fontSize: 14 },
})
