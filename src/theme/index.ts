/**
 * src/theme/index.ts — single import surface for the newsprint theme.
 */
export { colors } from './colors'
export { fonts, KICKER_LETTER_SPACING } from './typography'

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

/**
 * Sharp corners only — real newsprint has no rounded rectangles. A couple
 * of screens keep a 2px radius purely to stop hairline borders looking
 * jagged on low-density screens; nothing gets the old 8-16px pill/card look.
 */
export const radius = {
  none: 0,
  hairline: 2,
} as const
