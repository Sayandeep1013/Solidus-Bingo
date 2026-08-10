import { Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '@/theme'

/** 3 / 5 / 10 / 15 / 30 minutes per player — spec bingo-disconnect-recovery §3.2.
 * Kept in sync by hand with the same list validated server-side in
 * create-room and join-queue (VALID_TIME_BANKS_MS). */
export const TIME_BANK_PRESETS_MS = [180_000, 300_000, 600_000, 900_000, 1_800_000] as const
export type TimeBankMs = (typeof TIME_BANK_PRESETS_MS)[number]

function presetLabel(ms: TimeBankMs): string {
  return `${ms / 60_000}`
}

/** Shared time-bank picker used at both private-room creation and ranked
 * queueing — chess.com-style time-control buckets (spec §4: ranked
 * matching requires both capacity AND time bank to agree). */
export function TimeBankPicker({
  value,
  onChange,
}: {
  value: TimeBankMs
  onChange: (ms: TimeBankMs) => void
}) {
  return (
    <View style={styles.row}>
      {TIME_BANK_PRESETS_MS.map((ms) => {
        const selected = value === ms
        return (
          <TouchableOpacity
            key={ms}
            style={[styles.option, selected && styles.selected]}
            onPress={() => onChange(ms)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${presetLabel(ms)} minutes per player`}
          >
            <Text style={[styles.number, selected && styles.numberSelected]}>{presetLabel(ms)}</Text>
            <Text style={styles.caption}>min</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  option: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.hairline,
    backgroundColor: colors.paperMuted,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.ruleFaint,
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.paper },
  number: { fontFamily: fonts.headlineBlack, fontSize: 20, color: colors.inkFaint },
  numberSelected: { color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 10, color: colors.inkFaded, marginTop: 2 },
})
