/**
 * src/theme/typography.ts
 *
 * Four families, matching how a real newspaper page is set:
 *
 *   - UnifrakturMaguntia — the nameplate. Blackletter, the way papers have set
 *     their own name since they were the only thing anyone set in it. Used for
 *     "Solidus Bingo" itself and nowhere else.
 *   - Grenze Gotisch — the headline face. Blackletter-flavoured but drawn for
 *     legibility at a glance, which is what makes it usable for headlines the
 *     nameplate face would render unreadable.
 *   - Playfair Display — kept for anything the reader has to parse rather than
 *     recognise: board numbers, scores, room codes, leaderboard values. See the
 *     note below.
 *   - PT Serif — body text, buttons, labels.
 *
 * WHY NUMBERS AND CODES DID NOT MOVE TO THE GOTHIC FACES
 *
 * Blackletter is a display face: it is read as a shape, not decoded letter by
 * letter. That is exactly wrong for a 5×5 grid of numerals you tap under time
 * pressure, or a six-character room code someone is reading aloud down a phone
 * — a gothic 5/6, or I/J, costs a misdialled room or a wrong tap. Those stay on
 * Playfair, which is still unmistakably a newspaper serif.
 *
 * The nameplate is set in Title Case, never uppercase. Blackletter capitals are
 * ornamental, and a word set entirely in them stops being readable at all.
 *
 * fontsLoaded (checked via useFonts in app/_layout.tsx) gates rendering, so
 * every screen can assume these are available.
 */
export const fonts = {
  /** The paper's own name. Title Case only — see note above. */
  nameplate: 'UnifrakturMaguntia_400Regular',

  /** Screen headlines: "Play Ranked", "Bot Ada Wins", "Your Turn". */
  display: 'GrenzeGotisch_700Bold',
  displayHeavy: 'GrenzeGotisch_800ExtraBold',

  /** Numerals, codes and values — legibility over character. */
  headlineBlack: 'PlayfairDisplay_900Black',
  headlineBold: 'PlayfairDisplay_700Bold',
  headlineBoldItalic: 'PlayfairDisplay_700Bold_Italic',

  body: 'PTSerif_400Regular',
  bodyItalic: 'PTSerif_400Regular_Italic',
  bodyBold: 'PTSerif_700Bold',
} as const

/** Wide letter-spacing for small-caps-style kicker/section labels */
export const KICKER_LETTER_SPACING = 2.2
