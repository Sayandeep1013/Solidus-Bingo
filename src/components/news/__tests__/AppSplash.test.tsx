/**
 * src/components/news/__tests__/AppSplash.test.tsx
 *
 * The two properties that decide whether the cold start looks right:
 *   - the native splash is handed over on layout and exactly once, across the
 *     two AppSplash instances boot renders (dismissing it before something
 *     else is drawn is what left ~2s of blank paper on screen)
 *   - the nameplate is held for MIN_VISIBLE_MS even when auth resolves instantly
 */
import React from 'react'
import { Image } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { AppSplash } from '../AppSplash'

// AppSplash stamps its own start time when its module is evaluated, which the
// import above just did — so this is within a millisecond of it. Tests that
// care about the minimum hold rewind the clock here first, since by the time
// they run, several seconds of "app uptime" have really elapsed.
const JS_STARTED_AT = Date.now()

const mockHideAsync = jest.fn(() => Promise.resolve(true))
jest.mock('expo-splash-screen', () => ({
  hideAsync: () => mockHideAsync(),
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
}))

function render(visible: boolean) {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<AppSplash visible={visible} />)
  })
  return tree
}

function layout(tree: ReactTestRenderer) {
  const [view] = tree.root.findAll(
    (n) => typeof n.type !== 'string' && Boolean(n.props.onLayout)
  )
  act(() => view.props.onLayout())
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('AppSplash', () => {
  // One test, because the "exactly once" latch is module-level state — the
  // point of it is precisely that it survives across mounts.
  test('hands the native splash over on layout, and only once', () => {
    const first = render(true)
    expect(mockHideAsync).not.toHaveBeenCalled()

    layout(first)
    expect(mockHideAsync).toHaveBeenCalledTimes(1)

    // Boot renders AppSplash twice: once while fonts load, then again as the
    // overlay over the navigator. The second must not re-dismiss.
    layout(first)
    layout(render(true))
    expect(mockHideAsync).toHaveBeenCalledTimes(1)
  })

  test('holds for the minimum when auth resolves instantly, then clears itself', () => {
    jest.setSystemTime(JS_STARTED_AT)
    const tree = render(false)

    // A second in, the nameplate is still there rather than having flickered.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(tree.toJSON()).not.toBeNull()

    // …and it does go away — a splash that never unmounts would sit invisibly
    // over the app forever.
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(tree.toJSON()).toBeNull()
  })

  test('draws the splash artwork rather than an empty view', () => {
    const tree = render(true)
    expect(tree.root.findAllByType(Image).length).toBeGreaterThan(0)
  })
})
