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
import { AppSplash, remainingHoldMs, MIN_VISIBLE_MS, FADE_OUT_MS } from '../AppSplash'

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

  test('never unmounts synchronously, and does clear itself once the hold and fade are done', () => {
    const tree = render(false)

    // Whatever the clock says, auth resolving must not yank the nameplate away
    // in the same tick — that is the flicker this component exists to prevent.
    expect(tree.toJSON()).not.toBeNull()

    // …and it must not linger either. A splash that never unmounts would sit
    // invisibly over the app forever.
    act(() => {
      jest.advanceTimersByTime(MIN_VISIBLE_MS + FADE_OUT_MS + 100)
    })
    expect(tree.toJSON()).toBeNull()
  })

  test('draws the splash artwork rather than an empty view', () => {
    const tree = render(true)
    expect(tree.root.findAllByType(Image).length).toBeGreaterThan(0)
  })
})

// The hold is the whole point of the component, so it is asserted directly on
// the arithmetic rather than by racing a real clock through a render.
describe('remainingHoldMs', () => {
  const START = 1_000_000

  test('holds the full minimum when auth resolves the instant the app starts', () => {
    expect(remainingHoldMs(START, START)).toBe(MIN_VISIBLE_MS)
  })

  test('holds only the remainder when boot has already used some of it', () => {
    expect(remainingHoldMs(START + 400, START)).toBe(MIN_VISIBLE_MS - 400)
  })

  test('adds no delay at all once the minimum has already elapsed', () => {
    expect(remainingHoldMs(START + MIN_VISIBLE_MS + 5_000, START)).toBe(0)
  })
})
