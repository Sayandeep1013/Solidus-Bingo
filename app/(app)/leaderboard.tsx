/**
 * app/(app)/leaderboard.tsx — LeaderboardScreen
 *
 * Spec: .kiro/specs/bingo-leaderboard/requirements.md
 * Two sort modes: Most Wins (everyone with >=1 ranked game) and Best Win
 * Rate (only players with >=5 ranked games — spec Req 2.3, 3.5-3.6).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'

type SortMode = 'wins' | 'win_rate'

interface Entry {
  player_id: string
  username: string
  games_played: number
  games_won: number
  win_rate: number
  rank: number
}

const WIN_RATE_MIN_GAMES = 5

export default function LeaderboardScreen() {
  const { userId } = useAuth()
  const [sort, setSort] = useState<SortMode>('wins')
  const [entries, setEntries] = useState<Entry[]>([])
  const [myEntry, setMyEntry] = useState<Entry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (sortMode: SortMode, isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true)
    else setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await invokeEdgeFunction('get-leaderboard', {
        body: { sort: sortMode },
      })
      if (fnError || !data?.ok) {
        setError(data?.error?.message ?? fnError?.message ?? 'Failed to load leaderboard')
        return
      }
      setEntries(data.data.entries ?? [])
      setMyEntry(data.data.my_entry ?? null)
    } catch {
      setError('Network error — please try again')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(sort)
  }, [sort, load])

  const myRowInPage = entries.some((e) => e.player_id === userId)

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Leaderboard</Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, sort === 'wins' && styles.tabActive]}
          onPress={() => setSort('wins')}
          accessibilityRole="button"
          accessibilityLabel="Sort by most wins"
        >
          <Text style={[styles.tabText, sort === 'wins' && styles.tabTextActive]}>Most Wins</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, sort === 'win_rate' && styles.tabActive]}
          onPress={() => setSort('win_rate')}
          accessibilityRole="button"
          accessibilityLabel="Sort by best win rate"
        >
          <Text style={[styles.tabText, sort === 'win_rate' && styles.tabTextActive]}>Best Win Rate</Text>
        </TouchableOpacity>
      </View>

      {sort === 'win_rate' && (
        <Text style={styles.qualifyNote}>
          Win rate ranking requires {WIN_RATE_MIN_GAMES}+ ranked games played
        </Text>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator color="#6c63ff" size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.player_id}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => load(sort, true)} tintColor="#6c63ff" />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {sort === 'win_rate'
                ? `No one has played ${WIN_RATE_MIN_GAMES}+ ranked games yet.`
                : 'No ranked games played yet — be the first!'}
            </Text>
          }
          ListFooterComponent={
            !myRowInPage && myEntry ? (
              <View style={styles.myPositionFooter}>
                <Text style={styles.myPositionLabel}>Your position</Text>
                <LeaderboardRow entry={myEntry} isMe sort={sort} />
              </View>
            ) : !myEntry ? (
              <Text style={styles.emptyText}>
                {sort === 'win_rate'
                  ? "You haven't qualified for win rate ranking yet."
                  : "You haven't played a ranked game yet — try Ranked Play from the home screen!"}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <LeaderboardRow entry={item} isMe={item.player_id === userId} sort={sort} />
          )}
        />
      )}
    </View>
  )
}

function LeaderboardRow({ entry, isMe, sort }: { entry: Entry; isMe: boolean; sort: SortMode }) {
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={styles.rank}>#{entry.rank}</Text>
      <View style={styles.rowMiddle}>
        <Text style={styles.username}>
          {entry.username}
          {isMe ? ' (you)' : ''}
        </Text>
        <Text style={styles.rowSub}>
          {entry.games_won} wins · {entry.games_played} played
        </Text>
      </View>
      <Text style={[styles.statValue, sort === 'win_rate' && styles.statValueHighlight]}>
        {sort === 'win_rate' ? `${entry.win_rate.toFixed(1)}%` : entry.games_won}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24, paddingTop: 60 },
  backButton: { marginBottom: 8 },
  backText: { color: '#6c63ff', fontSize: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#ffffff', marginBottom: 16 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#2a2a40', borderWidth: 1, borderColor: '#3a3a55',
  },
  tabActive: { backgroundColor: '#2a2a50', borderColor: '#6c63ff' },
  tabText: { color: '#888888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#ffffff' },
  qualifyNote: { color: '#666666', fontSize: 12, marginBottom: 12, textAlign: 'center' },
  errorText: { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginVertical: 8 },
  emptyText: { color: '#666666', fontSize: 14, textAlign: 'center', marginTop: 24, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2a2a40',
    borderRadius: 10, padding: 14, marginBottom: 8, gap: 12,
    borderWidth: 1, borderColor: '#3a3a55',
  },
  rowMe: { borderColor: '#6c63ff', backgroundColor: '#2a2a50' },
  rank: { color: '#666666', fontSize: 14, fontWeight: '700', width: 32 },
  rowMiddle: { flex: 1, gap: 2 },
  username: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  rowSub: { color: '#888888', fontSize: 12 },
  statValue: { color: '#6c63ff', fontSize: 20, fontWeight: '700' },
  statValueHighlight: { color: '#00cc88' },
  myPositionFooter: { marginTop: 12, marginBottom: 24 },
  myPositionLabel: { color: '#888888', fontSize: 12, textTransform: 'uppercase', marginBottom: 6 },
})
