import type { ReactNode } from 'react'
import { ImageBackground, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { colors } from '@/theme'

/**
 * Base "sheet of paper" for every screen: a generated aged-newsprint grain
 * texture (foxed mottling + fine fibre + fleck speckle — see
 * assets/paper-texture.jpg, generated offline) under a faint darkened-edge
 * vignette. Rendered with resizeMode="cover" rather than tiled, since the
 * source texture is non-seamless — cover avoids any visible tile seam
 * regardless of screen size.
 *
 * THE BOTTOM INSET IS APPLIED HERE, DELIBERATELY
 *
 * The app draws edge to edge (see app/_layout.tsx), so the window now extends
 * underneath Android's gesture bar. That is what makes the paper run to the
 * very bottom of the display instead of stopping at a black slab — but it also
 * means anything bottom-anchored would sit under the gesture pill.
 *
 * Every screen in the app wraps in this component, so padding the children
 * once here fixes all of them at a stroke and, more to the point, cannot be
 * forgotten on the next screen someone adds. The texture and vignette are
 * outside that padding and still paint the full height, so the paper continues
 * behind the bar while the content clears it.
 *
 * Screens must therefore NOT add insets.bottom of their own — that double-pads.
 * insets.top is still each screen's own business, since headers vary.
 */
export function PaperBackground({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()

  return (
    <ImageBackground
      source={require('../../../assets/paper-texture.jpg')}
      resizeMode="cover"
      style={styles.container}
    >
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.paperDark, 'transparent']}
        style={styles.topVignette}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', colors.paperDark]}
        style={styles.bottomVignette}
      />
    </ImageBackground>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1 },
  topVignette: { position: 'absolute', top: 0, left: 0, right: 0, height: 40, opacity: 0.5 },
  bottomVignette: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, opacity: 0.4 },
})
