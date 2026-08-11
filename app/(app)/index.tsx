/**
 * app/(app)/index.tsx — HomeScreen
 *
 * Entry point for authenticated users: ranked matchmaking, private rooms,
 * bot practice, and the leaderboard. Laid out like a paper's front page —
 * masthead, a lead story (Ranked), then sections below.
 *
 * Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.8 — on
 * load, checks get-my-status for (a) a game the player can resume, and
 * (b) a game that finished while they weren't present to see it. Before
 * this existed, both were invisible until the player hit a confusing
 * ALREADY_IN_GAME error trying to do something else.
 */
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useRoomStore } from '@/store/roomStore'
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction'
import { applyGameSnapshot } from '@/lib/gameSnapshot'
import { colors, fonts, spacing, radius, KICKER_LETTER_SPACING } from '@/theme'
import { Masthead, PaperBackground, NewsButton, NewsCard, SectionLabel, Divider, ConfirmDialog } from '@/components/news'

interface ActiveGame { room_id: string; game_id: string; capacity: number }
interface UnseenResult { room_id: string; game_id: string; capacity: number; outcome: 'WON' | 'LOST' | 'DRAW' }

const OUTCOME_TEXT: Record<UnseenResult['outcome'], string> = {
  WON: 'you won',
  LOST: 'you lost',
  DRAW: 'it ended in a draw',
}

export default function HomeScreen() {
  const { profile, signOut } = useAuth()
  const setRoom = useRoomStore((s) => s.setRoom)
  const insets = useSafeAreaInsets()

  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null)
  const [unseenResult, setUnseenResult] = useState<UnseenResult | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  // Signing out is a one-tap way to lose your session from a footer link sat
  // right under the page — worth a confirm, and one that looks like the rest of
  // the paper rather than the OS's own blue-buttoned Alert.
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const loadStatus = useCallback(async () => {
    const { data } = await invokeEdgeFunction('get-my-status', { body: {} })
    if (data?.ok) {
      setActiveGame(data.data.active_game ?? null)
      setUnseenResult(data.data.unseen_result ?? null)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleResume = async () => {
    if (!activeGame) return
    setIsResuming(true)
    try {
      const { data } = await invokeEdgeFunction('get-game-state', { body: { game_id: activeGame.game_id } })
      if (data?.data) applyGameSnapshot(data.data)
      setRoom({
        roomId: activeGame.room_id,
        roomCode: null,
        capacity: activeGame.capacity,
        roomStatus: 'IN_GAME',
        hostId: '',
        players: [],
      })
      router.push(`/(app)/game/${activeGame.game_id}`)
    } finally {
      setIsResuming(false)
    }
  }

  const handleLeaveInstead = async () => {
    if (!activeGame) return
    setIsLeaving(true)
    try {
      await invokeEdgeFunction('forfeit-self', { body: { game_id: activeGame.game_id } })
      setActiveGame(null)
    } finally {
      setIsLeaving(false)
    }
  }

  const handleDismissResult = async () => {
    if (!unseenResult) return
    const dismissed = unseenResult
    setUnseenResult(null)
    await invokeEdgeFunction('acknowledge-result', { body: { room_id: dismissed.room_id } })
  }

  return (
    <PaperBackground>
      {/* Fixed header — never affected by scroll position, so the masthead
          can't ever render mid-clipped the way it could when it scrolled
          together with the rest of the page. */}
      {/* The nameplate sits well below the status bar — a front page gives its
          own name air above it rather than butting it against the notch. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xxl }]}>
        <Masthead
          kicker={`Reader: ${profile?.username ?? 'Player'}`}
          title="Solidus Bingo"
          tagline="Today's Edition — Pick Your Game"
        />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {activeGame ? (
          <View style={styles.noticeOuter}>
            <View style={styles.noticeInner}>
              <Text style={styles.noticeKicker}>Stop Press</Text>
              <Text style={styles.noticeTitle}>You have a game in progress</Text>
              <Text style={styles.noticeSubtitle}>
                {activeGame.capacity}-player game — pick up where you left off, or leave it behind.
              </Text>
              <View style={styles.noticeActions}>
                <NewsButton
                  label="Continue"
                  onPress={handleResume}
                  variant="accent"
                  loading={isResuming}
                  accessibilityLabel="Continue your game in progress"
                />
                <NewsButton
                  label="Leave This Game"
                  onPress={handleLeaveInstead}
                  variant="plain"
                  loading={isLeaving}
                  accessibilityLabel="Forfeit and leave the game in progress"
                />
              </View>
            </View>
          </View>
        ) : null}

        {unseenResult ? (
          <NewsCard style={styles.awayCard}>
            <Text style={styles.awayKicker}>While You Were Away</Text>
            <Text style={styles.awayText}>
              Your {unseenResult.capacity}-player game finished — {OUTCOME_TEXT[unseenResult.outcome]}.
            </Text>
            <TouchableOpacity
              onPress={handleDismissResult}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={styles.awayDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </NewsCard>
        ) : null}

        <View style={styles.leadStoryOuter}>
          <View style={styles.leadStoryInner}>
            <View style={styles.leadStoryHeader}>
              <Ionicons name="trophy-outline" size={22} color={colors.accent} />
              <Text style={styles.leadStoryTitle}>Play Ranked</Text>
            </View>
            <Text style={styles.leadStorySubtitle}>
              Auto-matchmaking — every result counts toward the leaderboard
            </Text>
            <View style={styles.leadStoryFooter}>
              <TouchableOpacity
                style={styles.leadStoryPlayButton}
                onPress={() => router.push('/(app)/ranked-play')}
                accessibilityRole="button"
                accessibilityLabel="Play ranked"
              >
                <Text style={styles.leadStoryPlayLabel}>Play</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.paper} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel>Private Room</SectionLabel>
          <View style={styles.row}>
            <View style={styles.half}>
              <NewsButton label="Create Room" onPress={() => router.push('/(app)/create-room')} accessibilityLabel="Create a room" />
            </View>
            <View style={styles.half}>
              <NewsButton label="Join Room" onPress={() => router.push('/(app)/join-room')} accessibilityLabel="Join a room with a code" />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel>Practice</SectionLabel>
          <NewsButton
            label="Play vs Bot"
            onPress={() => router.push('/(app)/bot-setup')}
            icon="hardware-chip-outline"
            IconComponent={Ionicons}
            accessibilityLabel="Play against bots"
          />
        </View>

        <View style={styles.section}>
          <SectionLabel>Standings</SectionLabel>
          <NewsCard style={styles.leaderboardCard}>
            <TouchableOpacity
              style={styles.leaderboardRow}
              onPress={() => router.push('/(app)/leaderboard')}
              accessibilityRole="button"
              accessibilityLabel="View leaderboard"
            >
              <MaterialCommunityIcons name="podium-gold" size={20} color={colors.ink} />
              <Text style={styles.leaderboardText}>Leaderboard</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.inkFaded} />
            </TouchableOpacity>
          </NewsCard>
        </View>

        <View style={styles.footer}>
          {/* Stub rule, not the full-width one that used to sit here — edge to
              edge reads as another section boundary, when what the colophon
              wants is an ornamental break. */}
          <Divider thick short />
          <Text style={styles.footerWordmark}>Solidus Bingo</Text>
          <Text style={styles.footerTagline}>Printed for Friends &amp; Family · Est. 2026</Text>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={() => setConfirmSignOut(true)}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmSignOut}
        kicker="Cancel Subscription"
        title="Sign out of Solidus Bingo?"
        message="You'll be returned to the login page. Your results, standings and username all stay exactly as they are — signing back in picks up where you left off."
        confirmLabel="Sign Out"
        cancelLabel="Stay"
        isConfirming={isSigningOut}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setIsSigningOut(true)
          try {
            await signOut()
          } finally {
            // AuthContext clears the session either way, so this screen is on
            // its way out; resetting anyway keeps the dialog from being left
            // spinning if the redirect is ever slower than the sign-out.
            setIsSigningOut(false)
            setConfirmSignOut(false)
          }
        }}
      />
    </PaperBackground>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingBottom: spacing.sm },
  container: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: spacing.lg, paddingBottom: 40, gap: spacing.xl },
  noticeOuter: {
    borderWidth: 2.5,
    borderColor: colors.ink,
    padding: 4,
  },
  noticeInner: {
    backgroundColor: colors.paperMuted,
    borderWidth: 1,
    borderColor: colors.ink,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noticeKicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING, color: colors.accent,
  },
  noticeTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  noticeSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaded },
  noticeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  awayCard: { gap: spacing.xs },
  awayKicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: KICKER_LETTER_SPACING, color: colors.inkFaded,
  },
  awayText: { fontFamily: fonts.bodyItalic, fontSize: 14, color: colors.ink },
  awayDismiss: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent, marginTop: spacing.xs },
  leadStoryOuter: {
    borderWidth: 2.5,
    borderColor: colors.accent,
    padding: 4,
  },
  leadStoryInner: {
    backgroundColor: colors.paperMuted,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.lg,
    gap: 6,
  },
  leadStoryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leadStoryTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.accent },
  leadStorySubtitle: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.inkFaded },
  leadStoryFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs },
  leadStoryPlayButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.accent, borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: radius.hairline, paddingVertical: 8, paddingHorizontal: 18,
  },
  leadStoryPlayLabel: { fontFamily: fonts.bodyBold, fontSize: 14, letterSpacing: 0.3, color: colors.paper },
  section: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  leaderboardCard: { padding: 0 },
  leaderboardRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 14, paddingHorizontal: spacing.md,
  },
  leaderboardText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  footer: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxl },
  footerWordmark: {
    fontFamily: fonts.nameplate, fontSize: 24, letterSpacing: 0,
    color: colors.inkFaded, marginTop: spacing.sm, lineHeight: 32,
    includeFontPadding: false,
  },
  footerTagline: { fontFamily: fonts.bodyItalic, fontSize: 12, color: colors.inkFaint },
  signOutButton: { alignItems: 'center', paddingVertical: spacing.xs, marginTop: spacing.xs },
  signOutText: { fontFamily: fonts.body, color: colors.inkFaded, fontSize: 13, fontStyle: 'italic' },
})
