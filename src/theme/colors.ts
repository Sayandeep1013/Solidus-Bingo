/**
 * src/theme/colors.ts — Newsprint palette.
 *
 * Real newspapers are black ink on cream/off-white paper with, at most, one
 * spot color (the classic "masthead red" used for banners and rules).
 * There is no purple/blue accent family here on purpose — that was the old
 * generic-app palette this theme replaces.
 */
export const colors = {
  // Paper surfaces
  paper: '#F2ECDA', // base page background — warm, slightly yellowed cream
  paperMuted: '#E8DFC6', // secondary surface (cards, input fields)
  paperDark: '#DED2AF', // tertiary surface (pressed/selected states)

  // Ink
  ink: '#1C1712', // primary text — warm near-black, not pure #000
  inkFaded: '#6B6152', // secondary text, captions, placeholders
  inkFaint: '#9A8F78', // disabled text, hairline decorative marks

  // Rules & borders
  rule: '#1C1712', // hairline dividers, article borders — same as ink
  ruleFaint: '#C9BB94', // lighter rule for subtle separators inside a card

  // Spot color — the one accent, used sparingly (mastheads, primary CTAs,
  // the current-turn banner, win states)
  accent: '#5C3A21',
  accentDark: '#3E2515',
  accentMuted: '#B99878',

  // Semantic (kept inside the newsprint family — no bright green/red UI colors)
  success: '#33502F',
  danger: '#5C3A21',
  disabled: '#B9AD8E',

  // Overlays
  scrim: 'rgba(28, 23, 18, 0.55)',
} as const

export type ColorToken = keyof typeof colors
