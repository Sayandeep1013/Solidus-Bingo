/**
 * app/(app)/leaderboard.tsx — LeaderboardScreen
 *
 * Spec: .kiro/specs/bingo-leaderboard/requirements.md;
 * .kiro/specs/bingo-disconnect-recovery/requirements.md §3.1 (mode split)
 *
 * Two sort modes: Most Wins (everyone with >=1 ranked game) and Best Win
 * Rate (only players with >=5 ranked games at THIS party size — spec Req
 * 2.3, 3.5-3.6 / disconnect-recovery Req 3.1.3), each further split by
 * party size (2/3/4 players) — a 4-player win is a different ranking from
 * a 2-player win, never mixed together.
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
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { colors, fonts, spacing, radius, KICKER_LETTER_SPACING } from '@/theme'
import { PaperBackground, PageHeader, Divider } from '@/components/news'

type SortMode = 'wins' | 'win_rate'
type Capacity = 2 | 3 | 4

interface Entry {
  player_id: string
  username: string
  games_played: number
  games_won: number
  win_rate: number
  rank: number
}

const WIN_RATE_MIN_GAMES = 5
const CAPACITIES: Capacity[] = [2, 3, 4]

export default function LeaderboardScreen() {
  const { userId } = useAuth()
  const [sort, setSort] = useState<SortMode>('wins')
  const [capacity, setCapacity] = useState<Capacity>(2)
  const [entries, setEntries] = useState<Entry[]>([])
  const [myEntry, setMyEntry] = useState<Entry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (sortMode: SortMode, mode: Capacity, isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true)
    else setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await invokeEdgeFunction('get-leaderboard', {
        body: { sort: sortMode, capacity: mode },
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
    load(sort, capacity)
  }, [sort, capacity, load])

  const myRowInPage = entries.some((e) => e.player_id === userId)

  return (
    <PaperBackground>
      <PageHeader title="Leaderboard" backLabel="Back" />
      <View style={styles.container}>
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

        <View style={styles.modeRow}>
          {CAPACITIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.modeTab, capacity === c && styles.modeTabActive]}
              onPress={() => setCapacity(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c} player games`}
              accessibilityState={{ selected: capacity === c }}
            >
              <Text style={[styles.modeTabText, capacity === c && styles.modeTabTextActive]}>{c} Players</Text>
            </TouchableOpacity>
          ))}
        </View>

        {sort === 'win_rate' && (
          <Text style={styles.qualifyNote}>
            Win rate ranking requires {WIN_RATE_MIN_GAMES}+ {capacity}-player ranked games played
          </Text>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {isLoading ? (
          <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.player_id}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={() => load(sort, capacity, true)} tintColor={colors.accent} />
            }
            ItemSeparatorComponent={() => <Divider style={styles.rowDivider} />}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {sort === 'win_rate'
                  ? `No one has played ${WIN_RATE_MIN_GAMES}+ ${capacity}-player ranked games yet.`
                  : `No ${capacity}-player ranked games played yet — be the first!`}
              </Text>
            }
            ListFooterComponent={
              !myRowInPage && myEntry ? (
                <View style={styles.myPositionFooter}>
                  <Text style={styles.myPositionLabel}>Your Position</Text>
                  <Divider />
                  <LeaderboardRow entry={myEntry} isMe sort={sort} />
                </View>
              ) : !myEntry ? (
                <Text style={styles.emptyText}>
                  {sort === 'win_rate'
                    ? "You haven't qualified for win rate ranking yet."
                    : "You haven't played a ranked game at this party size yet — try Ranked Play from the home screen!"}
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <LeaderboardRow entry={item} isMe={item.player_id === userId} sort={sort} />
            )}
          />
        )}
      </View>
    </PaperBackground>
  )
}

function LeaderboardRow({ entry, isMe, sort }: { entry: Entry; isMe: boolean; sort: SortMode }) {
  const isTopThree = entry.rank <= 3
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      {isTopThree ? (
        <MaterialCommunityIcons
          name={entry.rank === 1 ? 'podium-gold' : entry.rank === 2 ? 'podium-silver' : 'podium-bronze'}
          size={20}
          color={colors.accent}
          style={styles.rankIcon}
        />
      ) : (
        <Text style={styles.rank}>#{entry.rank}</Text>
      )}
      <View style={styles.rowMiddle}>
        <Text style={styles.username}>
          {entry.username}
          {isMe ? ' (you)' : ''}
        </Text>
        <Text style={styles.rowSub}>
          {entry.games_won} wins · {entry.games_played} played
        </Text>
      </View>
      <Text style={styles.statValue}>
        {sort === 'win_rate' ? `${entry.win_rate.toFixed(1)}%` : entry.games_won}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    backgroundColor: colors.paperMuted, borderWidth: 1, borderColor: colors.ruleFaint,
    borderRadius: radius.hairline,
  },
  tabActive: { backgroundColor: colors.paper, borderColor: colors.accent, borderWidth: 1.5 },
  tabText: { fontFamily: fonts.bodyBold, color: colors.inkFaded, fontSize: 13 },
  tabTextActive: { color: colors.ink },
  modeRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  modeTab: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  modeTabActive: { borderBottomColor: colors.accent },
  modeTabText: {
    fontFamily: fonts.bodyBold, color: colors.inkFaint, fontSize: 11,
    letterSpacing: KICKER_LETTER_SPACING,
  },
  modeTabTextActive: { color: colors.accent },
  qualifyNote: {
    fontFamily: fonts.bodyItalic, color: colors.inkFaded, fontSize: 12,
    marginBottom: spacing.sm, textAlign: 'center',
  },
  errorText: { fontFamily: fonts.body, color: colors.accent, fontSize: 14, textAlign: 'center', marginVertical: spacing.xs },
  emptyText: { fontFamily: fonts.bodyItalic, color: colors.inkFaded, fontSize: 14, textAlign: 'center', marginTop: 24, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: spacing.sm,
  },
  rowMe: { backgroundColor: colors.paperMuted },
  rankIcon: { width: 32, textAlign: 'center' },
  rank: { fontFamily: fonts.headlineBold, color: colors.inkFaint, fontSize: 14, width: 32 },
  rowMiddle: { flex: 1, gap: 2 },
  username: { fontFamily: fonts.bodyBold, color: colors.ink, fontSize: 16 },
  rowSub: { fontFamily: fonts.body, color: colors.inkFaded, fontSize: 12 },
  statValue: { fontFamily: fonts.headlineBold, color: colors.accent, fontSize: 20 },
  rowDivider: { marginHorizontal: 0 },
  myPositionFooter: { marginTop: spacing.md, marginBottom: 24, gap: spacing.xs },
  myPositionLabel: {
    fontFamily: fonts.bodyBold, color: colors.inkFaded, fontSize: 11,
    letterSpacing: KICKER_LETTER_SPACING,
  },
})
