import { Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '@/theme'

/** Shared 2/3/4-player picker used by Create Room, Play vs Bot, and Ranked Play. */
export function CapacityPicker({
  value,
  onChange,
  labelFor,
}: {
  value: 2 | 3 | 4
  onChange: (n: 2 | 3 | 4) => void
  /** Optional per-option caption under the number, e.g. "1 bot" or "players" */
  labelFor?: (n: 2 | 3 | 4) => string
}) {
  const options: (2 | 3 | 4)[] = [2, 3, 4]
  return (
    <View style={styles.row}>
      {options.map((n) => {
        const selected = value === n
        return (
          <TouchableOpacity
            key={n}
            style={[styles.option, selected && styles.selected]}
            onPress={() => onChange(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${n} players`}
          >
            <Text style={[styles.number, selected && styles.numberSelected]}>{n}</Text>
            <Text style={styles.caption}>{labelFor ? labelFor(n) : 'players'}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: radius.hairline,
    backgroundColor: colors.paperMuted,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.ruleFaint,
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.paper },
  number: { fontFamily: fonts.headlineBlack, fontSize: 32, color: colors.inkFaint },
  numberSelected: { color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaded, marginTop: 4 },
})
