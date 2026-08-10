/**
 * src/lib/__tests__/appUpdate.test.ts
 *
 * This comparison decides whether a working app refuses to open, so the cases
 * that matter most are the ones where it must NOT fire.
 */
import { compareVersions, isBelowMinimum } from '../appUpdate'

// appUpdate pulls in the Supabase client, which builds itself from
// EXPO_PUBLIC_* env vars at module scope and throws when they are absent, as
// they are under jest. These tests exercise the pure comparison logic, so a
// stub is all that is needed to let the module load.
jest.mock('../supabaseClient', () => ({ supabase: {} }))

describe('compareVersions', () => {
  test('orders by numeric field, not lexically', () => {
    // The whole reason this is not a string compare: '1.0.10' < '1.0.9' as text.
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0)
  })

  test('does not collapse fields the way parseFloat would', () => {
    // parseFloat('1.0.10') is 1 — identical to parseFloat('1.0.2').
    expect(compareVersions('1.0.10', '1.0.2')).toBeGreaterThan(0)
  })

  test('treats missing trailing fields as zero', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0)
    expect(compareVersions('2', '2.0.0')).toBe(0)
  })

  test('compares major before minor before patch', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.1.99')).toBeGreaterThan(0)
    expect(compareVersions('1.0.1', '1.0.1')).toBe(0)
  })

  test('reads non-numeric junk as zero rather than NaN', () => {
    // NaN comparisons are all false, which would silently make every check pass
    // or fail depending on branch order. Zero is at least deterministic.
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
    expect(compareVersions('', '0.0.0')).toBe(0)
  })
})

describe('isBelowMinimum', () => {
  test('blocks a genuinely older build', () => {
    expect(isBelowMinimum('1.0.1', '1.0.2')).toBe(true)
  })

  test('allows the exact floor and anything newer', () => {
    expect(isBelowMinimum('1.0.2', '1.0.2')).toBe(false)
    expect(isBelowMinimum('1.1.0', '1.0.2')).toBe(false)
  })

  test('allows when the running version is unknown', () => {
    // An unknown version compares as older than any floor, so guessing here
    // would lock out exactly the users we know least about.
    expect(isBelowMinimum(null, '1.0.2')).toBe(false)
  })

  test('allows when no floor could be read', () => {
    expect(isBelowMinimum('1.0.1', null)).toBe(false)
  })

  test('allows everything at the seeded default floor', () => {
    // The migration ships min_supported_version = '0.0.0'; the gate must be
    // inert until someone raises it on purpose.
    expect(isBelowMinimum('1.0.0', '0.0.0')).toBe(false)
    expect(isBelowMinimum('0.0.1', '0.0.0')).toBe(false)
  })
})
