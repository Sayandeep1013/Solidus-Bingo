/**
 * src/theme/typography.ts
 *
 * Three type families, matching how a real newspaper page is set:
 *   - Anton — the nameplate/masthead face (heavy condensed grotesk, used
 *     once per screen at most, for the paper's own name)
 *   - Playfair Display — the headline face (high-contrast serif, used for
 *     section/result headlines below the masthead)
 *   - PT Serif — the body/text face used everywhere else, including
 *     buttons and labels, for that "set in metal type" reading feel
 *
 * fontsLoaded (checked via useFonts in app/_layout.tsx) gates rendering,
 * so every screen can assume these are available.
 */
export const fonts = {
  masthead: 'Anton_400Regular',
  headlineBlack: 'PlayfairDisplay_900Black',
  headlineBold: 'PlayfairDisplay_700Bold',
  headlineBoldItalic: 'PlayfairDisplay_700Bold_Italic',
  body: 'PTSerif_400Regular',
  bodyItalic: 'PTSerif_400Regular_Italic',
  bodyBold: 'PTSerif_700Bold',
} as const

/** Wide letter-spacing for small-caps-style kicker/section labels */
export const KICKER_LETTER_SPACING = 2.2
