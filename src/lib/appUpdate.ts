/**
 * src/lib/appUpdate.ts — the client half of the minimum-version gate.
 *
 * See supabase/migrations/20260811000000_app_update_gate.sql for why this
 * exists: a sideloaded APK has no update mechanism, so the shared backend is
 * the only lever for retiring a build.
 *
 * Everything here fails OPEN. A player with a working app must never be locked
 * out of it because a config row was unreadable, a version string was missing,
 * or the network was down — the cost of wrongly blocking is far higher than the
 * cost of an old build running one session longer than intended.
 */
import Constants from 'expo-constants'
import { supabase } from './supabaseClient'

/**
 * The running app's version, from app.json, embedded into the APK at build
 * time (it ships as assets/app.config).
 *
 * Null rather than a '0.0.0' fallback on purpose: an unknown version compares
 * as older than every floor, so a fallback would gate the app shut precisely
 * when we know least. Null means "can't tell", and the gate skips.
 */
export const APP_VERSION: string | null = Constants.expoConfig?.version ?? null

export interface UpdateGate {
  /**
   * A newer build exists and this one still works. Shown as a dismissible
   * notice, never a wall — the whole point of the soft prompt is that the
   * player decides when to act on it.
   */
  updateAvailable: boolean
  /** True only when we positively know this build is below the floor. */
  required: boolean
  latestVersion: string | null
  downloadUrl: string
  message: string | null
}

const DEFAULT_DOWNLOAD_URL = 'https://github.com/Sayandeep1013/Solidus-Bingo/releases/latest'

const ALLOWED: UpdateGate = {
  updateAvailable: false,
  required: false,
  latestVersion: null,
  downloadUrl: DEFAULT_DOWNLOAD_URL,
  message: null,
}

/**
 * Compares dotted numeric versions field by field: negative if `a` is older
 * than `b`, positive if newer, 0 if equal.
 *
 * Not a string comparison, which would put '1.0.10' before '1.0.9', and not
 * parseFloat, which would read '1.0.10' as 1.0. Missing fields count as 0, so
 * '1.1' and '1.1.0' are the same version. Non-numeric junk also reads as 0
 * rather than NaN, which keeps a malformed floor from failing every comparison.
 */
export function compareVersions(a: string, b: string): number {
  const fieldsA = a.split('.')
  const fieldsB = b.split('.')
  const length = Math.max(fieldsA.length, fieldsB.length)

  for (let i = 0; i < length; i++) {
    const numA = parseInt(fieldsA[i] ?? '0', 10) || 0
    const numB = parseInt(fieldsB[i] ?? '0', 10) || 0
    if (numA !== numB) return numA - numB
  }
  return 0
}

/** True when `version` is older than `minimum`. */
export function isBelowMinimum(version: string | null, minimum: string | null): boolean {
  if (!version || !minimum) return false
  return compareVersions(version, minimum) < 0
}

/**
 * Cached for the life of the process. The root layout asks on boot and Home
 * asks again to render its notice; without this that is two round trips for one
 * answer that cannot change mid-session.
 */
let inFlight: Promise<UpdateGate> | null = null

/**
 * Reads the floor and decides whether this build is retired, and separately
 * whether a newer one exists. Never throws and never rejects — every failure
 * path resolves to "allowed", with no update advertised.
 */
export function checkUpdateGate(): Promise<UpdateGate> {
  if (!inFlight) inFlight = fetchUpdateGate()
  return inFlight
}

async function fetchUpdateGate(): Promise<UpdateGate> {
  if (!APP_VERSION) return ALLOWED

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('min_supported_version, latest_version, download_url, message')
      .maybeSingle()

    if (error || !data) return ALLOWED

    const required = isBelowMinimum(APP_VERSION, data.min_supported_version)

    return {
      // Only worth mentioning while the build still runs — once it is below the
      // floor the blocking screen has already said everything, and offering a
      // dismissible nudge alongside it would just be confusing.
      updateAvailable: !required && isBelowMinimum(APP_VERSION, data.latest_version),
      required,
      latestVersion: data.latest_version ?? null,
      downloadUrl: data.download_url || DEFAULT_DOWNLOAD_URL,
      message: data.message ?? null,
    }
  } catch {
    return ALLOWED
  }
}
