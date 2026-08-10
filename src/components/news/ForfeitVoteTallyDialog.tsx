import { Modal, Text, View, StyleSheet } from 'react-native'
import { colors, fonts, spacing } from '@/theme'
import { NewsButton } from './NewsButton'

/**
 * 3-4 player forfeit-vote prompt (spec bingo-disconnect-recovery §3.4.2) —
 * the "sibling" of ConfirmDialog's 2-player single accept/deny prompt (§D3),
 * but with a live running tally since more than one other player can be
 * voting at once. Once the caller has cast a ballot, the vote buttons are
 * replaced by a status line — re-voting isn't exposed in this UI even
 * though the backend would accept it (upsert), to keep "you voted" feel
 * final, like a CS2/Valorant surrender vote.
 */
export function ForfeitVoteTallyDialog({
  visible,
  targetUsername,
  totalEligible,
  yesCount,
  noCount,
  secondsLeft,
  myChoice,
  onVoteYes,
  onVoteNo,
  isVoting,
}: {
  visible: boolean
  targetUsername: string
  totalEligible: number
  yesCount: number
  noCount: number
  secondsLeft: number
  myChoice: 'YES' | 'NO' | null
  onVoteYes: () => void
  onVoteNo: () => void
  isVoting: boolean
}) {
  const responded = yesCount + noCount

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.cardOuter}>
          <View style={styles.cardInner}>
            <Text style={styles.kicker}>Reader&apos;s Ballot</Text>
            <Text style={styles.title}>Claim forfeit against {targetUsername}?</Text>
            <Text style={styles.message}>
              They&apos;ve been gone a while. If everyone who votes says yes, they&apos;re out and the
              game continues without them.
            </Text>

            <View style={styles.tallyRow}>
              <Text style={styles.tallyText}>
                {responded} of {totalEligible} voted
              </Text>
              <Text style={styles.tallyBreakdown}>
                {yesCount} yes · {noCount} no
              </Text>
            </View>
            <Text style={styles.countdown}>{secondsLeft}s left to decide</Text>

            {myChoice ? (
              <Text style={styles.votedText}>
                You voted {myChoice === 'YES' ? 'to claim the forfeit' : 'to let them stay'} — waiting on
                the rest of the table.
              </Text>
            ) : (
              <View style={styles.actions}>
                <View style={styles.actionHalf}>
                  <NewsButton
                    label="Let Them Stay"
                    onPress={onVoteNo}
                    variant="secondary"
                    accessibilityLabel="Vote no — let them stay"
                    loading={isVoting}
                  />
                </View>
                <View style={styles.actionHalf}>
                  <NewsButton
                    label="Claim Forfeit"
                    onPress={onVoteYes}
                    variant="accent"
                    accessibilityLabel="Vote yes — claim the forfeit"
                    loading={isVoting}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: colors.scrim,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  cardOuter: { width: '100%', maxWidth: 420, borderWidth: 2.5, borderColor: colors.ink, padding: 4 },
  cardInner: {
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink,
    padding: spacing.lg, gap: spacing.sm,
  },
  kicker: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.2, color: colors.accent,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 21, color: colors.ink },
  message: { fontFamily: fonts.body, fontSize: 13, color: colors.inkFaded, lineHeight: 19 },
  tallyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.ruleFaint,
  },
  tallyText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  tallyBreakdown: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaded },
  countdown: { fontFamily: fonts.bodyItalic, fontSize: 12, color: colors.accent },
  votedText: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.inkFaded, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionHalf: { flex: 1 },
})
