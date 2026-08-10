import type { ComponentProps } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native'
import type { Ionicons } from '@expo/vector-icons'
import { colors, fonts, radius, spacing } from '@/theme'

type IconName = ComponentProps<typeof Ionicons>['name']

interface NewsButtonProps {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'accent' | 'plain'
  icon?: IconName
  IconComponent?: typeof Ionicons
  disabled?: boolean
  loading?: boolean
  accessibilityLabel?: string
}

/**
 * The one button primitive for the whole app — a flat bordered "printed
 * block", no rounded pill/gradient styling. `primary` = solid ink,
 * `accent` = the masthead-red spot color (reserve for the single most
 * important action on a screen), `secondary` = outlined, `plain` = for
 * destructive/low-emphasis actions (e.g. Leave, Sign Out).
 */
export function NewsButton({
  label,
  onPress,
  variant = 'secondary',
  icon,
  IconComponent,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: NewsButtonProps) {
  const isDisabled = disabled || loading
  const Icon = IconComponent

  return (
    <TouchableOpacity
      style={[styles.base, variantStyles[variant], isDisabled && styles.disabled]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading ? (
        <ActivityIndicator color={textColor[variant]} size="small" />
      ) : (
        <View style={styles.content}>
          {icon && Icon ? <Icon name={icon} size={17} color={textColor[variant]} style={styles.icon} /> : null}
          <Text style={[styles.label, { color: textColor[variant] }]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

const textColor: Record<NonNullable<NewsButtonProps['variant']>, string> = {
  primary: colors.paper,
  accent: colors.paper,
  secondary: colors.ink,
  plain: colors.accent,
}

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.ink, borderColor: colors.ink },
  accent: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.paper, borderColor: colors.ink },
  plain: { backgroundColor: 'transparent', borderColor: colors.ruleFaint },
})

const styles = StyleSheet.create({
  base: {
    borderWidth: 1.5,
    borderRadius: radius.hairline,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  disabled: { opacity: 0.45 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  icon: { marginRight: 2 },
  label: { fontFamily: fonts.bodyBold, fontSize: 16, letterSpacing: 0.3 },
})
