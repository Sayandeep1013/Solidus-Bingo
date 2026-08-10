import type { ReactNode } from 'react'
import { ImageBackground, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors } from '@/theme'

/**
 * Base "sheet of paper" for every screen: a generated aged-newsprint grain
 * texture (foxed mottling + fine fibre + fleck speckle — see
 * assets/paper-texture.jpg, generated offline) under a faint darkened-edge
 * vignette. Rendered with resizeMode="cover" rather than tiled, since the
 * source texture is non-seamless — cover avoids any visible tile seam
 * regardless of screen size.
 */
export function PaperBackground({ children }: { children: ReactNode }) {
  return (
    <ImageBackground
      source={require('../../../assets/paper-texture.jpg')}
      resizeMode="cover"
      style={styles.container}
    >
      {children}
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
  topVignette: { position: 'absolute', top: 0, left: 0, right: 0, height: 40, opacity: 0.5 },
  bottomVignette: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, opacity: 0.4 },
})
