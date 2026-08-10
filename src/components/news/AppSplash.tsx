/**
 * src/components/news/AppSplash.tsx — the JS-side splash screen.
 *
 * WHY THIS EXISTS (measured on a Nothing Phone, release APK, cold start):
 *
 *   +0.03s  Android's own launch window — the app icon on cream
 *   +0.57s  …that window exits
 *   +0.90s  ─┐
 *   +2.38s  ─┴ blank cream: React is mounted but every screen in the boot path
 *             (`_layout` while fonts load, `index` while auth resolves, the two
 *             group layouts) returned `null`, so all that was on screen was the
 *             window's background colour
 *   +2.75s  home screen
 *
 * The masthead artwork the native splash is configured with never got a chance
 * to sit there — the ~2s the user actually spends waiting was empty paper. So
 * the JS side now draws that same artwork itself, from the first frame it can,
 * and the native splash is only dismissed once this one is on screen. There is
 * no window in which nothing is drawn, and since both are `colors.paper` on the
 * same image, the handover is invisible.
 *
 * Render this — never `null` — anywhere the app is not yet ready to show a real
 * screen.
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, Image, StyleSheet } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { colors } from '@/theme'

/**
 * Floor on how long the masthead stays up, measured from JS start. A returning
 * user with a warm session resolves in a few hundred ms; without a floor the
 * splash reads as a flicker rather than a nameplate.
 */
const MIN_VISIBLE_MS = 1100

/** Long enough for the screen underneath to have mounted and painted. */
const FADE_OUT_MS = 260

const jsStartedAt = Date.now()

// hideAsync() is safe to call twice, but the promise rejects the second time —
// module-level latch keeps that noise out of the logs.
let nativeSplashHidden = false
function hideNativeSplash() {
  if (nativeSplashHidden) return
  nativeSplashHidden = true
  SplashScreen.hideAsync().catch(() => {})
}

/**
 * `visible` is a one-way latch: it may go true → false once, at the end of
 * boot, and must never go back. The root layout is responsible for holding it
 * false afterwards — a later `isLoading` flip (sign-in, sign-out) must not
 * bring the nameplate back over a screen the user is already looking at.
 */
export function AppSplash({ visible = true }: { visible?: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current
  const [mounted, setMounted] = useState(true)

  useEffect(() => {
    if (visible) return
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - jsStartedAt))
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // If something interrupts the fade we simply stay mounted at ~0
        // opacity with pointerEvents 'none' — invisible and non-blocking,
        // which is the right way to fail here.
        if (finished) setMounted(false)
      })
    }, remaining)
    return () => clearTimeout(timer)
  }, [visible, opacity])

  if (!mounted) return null

  return (
    <Animated.View
      style={[styles.container, { opacity }]}
      // Dismiss the native splash the moment this one has been laid out. Both
      // are the same cream, so even the frame before the image decodes looks
      // identical to what it replaced.
      onLayout={hideNativeSplash}
      // Once it is only fading out, taps belong to the screen underneath.
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={require('../../../assets/splash.png')}
        style={styles.image}
        resizeMode="contain"
        fadeDuration={0}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    // Must stay in step with app.json → expo.splash.backgroundColor.
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  image: { width: '100%', height: '100%' },
})
