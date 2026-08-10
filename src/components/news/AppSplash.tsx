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
 * and the native splash is only dismissed once this one is on screen.
 *
 * That still left the stretch *before* React mounts, which no JS can cover —
 * measured at ~1s on a first launch after install, while the bundle loads. The
 * nameplate is therefore also baked into the Android window background (see
 * MARK_PX below), so the OS itself paints it from the very first frame. The two
 * halves draw the same file at the same size on the same cream, so what the
 * user sees is one screen that simply stays put until the app is ready.
 *
 * Render this — never `null` — anywhere the app is not yet ready to show a real
 * screen.
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, Image, PixelRatio, StyleSheet } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { colors } from '@/theme'

/**
 * Intrinsic pixel width/height of assets/splash-mark.png.
 *
 * Android paints that exact file, at that exact size, centred, as the window
 * background — app.json → android.splash with resizeMode "native" builds it
 * into `@drawable/splashscreen`, so the OS draws it from the very first frame,
 * before any JS has run. This component then draws the same file at the same
 * pixel size on top, which is why the handover reads as one continuous screen
 * instead of the nameplate jumping size.
 *
 * Keep this in step with the CANVAS constant that generated the asset. The
 * mark occupies 620 of these 800px, so ~90px of cream sits either side even on
 * a 720px-wide screen — Android centre-crops rather than scales in "native"
 * mode, and that margin is what stops narrow screens clipping the nameplate.
 */
const MARK_PX = 800
const markSize = MARK_PX / PixelRatio.get()

/**
 * Floor on how long the masthead stays up, measured from JS start. A returning
 * user with a warm session resolves in a few hundred ms; without a floor the
 * splash reads as a flicker rather than a nameplate.
 */
export const MIN_VISIBLE_MS = 1100

/** Long enough for the screen underneath to have mounted and painted. */
export const FADE_OUT_MS = 260

const jsStartedAt = Date.now()

/**
 * How much of the minimum hold is still owed. Boot has usually eaten some of
 * it already, and once it has fully elapsed there is nothing left to wait for.
 *
 * Pulled out as a pure function because it is the only part of this component
 * that reasons about wall-clock time — testing it through the rendered
 * component means racing the clock the module captured at import, which is
 * exactly the sort of test that passes locally and fails on a slower runner.
 */
export function remainingHoldMs(now: number, startedAt: number = jsStartedAt): number {
  return Math.max(0, MIN_VISIBLE_MS - (now - startedAt))
}

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
    }, remainingHoldMs(Date.now()))
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
        source={require('../../../assets/splash-mark.png')}
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
  image: { width: markSize, height: markSize },
})
