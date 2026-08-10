#!/usr/bin/env node
/**
 * scripts/inject-android-signing.mjs
 *
 * Patches the Expo-generated android/app/build.gradle to sign release builds
 * with a real keystore instead of the debug key.
 *
 * Why this exists: `expo prebuild` regenerates android/ from scratch on every
 * CI run, and its template ships `buildTypes.release { signingConfig
 * signingConfigs.debug }` — i.e. release APKs are signed with the throwaway
 * debug key. That key is public and identical across every machine, so an APK
 * signed with it can't be meaningfully trusted and can never be updated by a
 * properly-signed build later (Android refuses upgrades across signing
 * identities). So the patch has to be reapplied after each prebuild.
 *
 * Credentials come from the environment, never from a file in the repo:
 *   ANDROID_KEYSTORE_PATH      (optional, default "release.p12", relative to android/app)
 *   ANDROID_KEYSTORE_PASSWORD
 *   ANDROID_KEY_ALIAS
 *   ANDROID_KEY_PASSWORD
 *
 * This script FAILS LOUDLY rather than silently no-op'ing. A silent failure
 * would produce a debug-signed "release" APK that looks fine, installs fine,
 * and is unfixable in the field — worth being noisy about.
 *
 * Idempotent: re-running against an already-patched file is a no-op.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const GRADLE_PATH = 'android/app/build.gradle'

/** Returns [startIndex, endIndex] of the block body opened by the `{` at or after `fromIndex`. */
function matchBlock(source, fromIndex) {
  const open = source.indexOf('{', fromIndex)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return [open, i]
    }
  }
  return null
}

function fail(message) {
  console.error(`\n[inject-android-signing] FAILED: ${message}`)
  console.error('[inject-android-signing] Refusing to continue — an unpatched build.gradle')
  console.error('[inject-android-signing] would silently produce a DEBUG-SIGNED release APK.')
  console.error('[inject-android-signing] The Expo template likely changed; update this script.\n')
  process.exit(1)
}

if (!existsSync(GRADLE_PATH)) {
  fail(`${GRADLE_PATH} not found — run \`expo prebuild --platform android\` first.`)
}

let gradle = readFileSync(GRADLE_PATH, 'utf8')

if (gradle.includes('// >>> injected by scripts/inject-android-signing.mjs')) {
  console.log('[inject-android-signing] Already patched — nothing to do.')
  process.exit(0)
}

// ── 1. Add a `release` entry to the signingConfigs block ────────────────────
const signingConfigsIdx = gradle.indexOf('signingConfigs')
if (signingConfigsIdx === -1) fail('no `signingConfigs` block found in build.gradle')

const signingBlock = matchBlock(gradle, signingConfigsIdx)
if (!signingBlock) fail('could not brace-match the `signingConfigs` block')

const [, signingClose] = signingBlock
const releaseSigningConfig = `
        // >>> injected by scripts/inject-android-signing.mjs
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "release.p12")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            storeType "PKCS12"
        }
        // <<< injected
`
gradle = gradle.slice(0, signingClose) + releaseSigningConfig + '    ' + gradle.slice(signingClose)

// ── 2. Point buildTypes.release at it ───────────────────────────────────────
// Scoped by brace-matching rather than a global replace: `signingConfig
// signingConfigs.debug` appears in buildTypes.debug too, and rewiring *that*
// one would break local debug builds.
const buildTypesIdx = gradle.indexOf('buildTypes')
if (buildTypesIdx === -1) fail('no `buildTypes` block found in build.gradle')

const buildTypesBlock = matchBlock(gradle, buildTypesIdx)
if (!buildTypesBlock) fail('could not brace-match the `buildTypes` block')

const [btOpen, btClose] = buildTypesBlock
const buildTypesBody = gradle.slice(btOpen, btClose + 1)

const releaseIdx = buildTypesBody.indexOf('release')
if (releaseIdx === -1) fail('no `release` build type found inside `buildTypes`')

const releaseBlock = matchBlock(buildTypesBody, releaseIdx)
if (!releaseBlock) fail('could not brace-match `buildTypes.release`')

const [relOpen, relClose] = releaseBlock
const releaseBody = buildTypesBody.slice(relOpen, relClose + 1)

if (!releaseBody.includes('signingConfig signingConfigs.debug')) {
  if (releaseBody.includes('signingConfig signingConfigs.release')) {
    console.log('[inject-android-signing] buildTypes.release already uses the release config.')
  } else {
    fail('`buildTypes.release` does not contain the expected `signingConfig signingConfigs.debug` line')
  }
} else {
  const patchedReleaseBody = releaseBody.replace(
    'signingConfig signingConfigs.debug',
    'signingConfig signingConfigs.release'
  )
  const patchedBuildTypes =
    buildTypesBody.slice(0, relOpen) + patchedReleaseBody + buildTypesBody.slice(relClose + 1)
  gradle = gradle.slice(0, btOpen) + patchedBuildTypes + gradle.slice(btClose + 1)
}

writeFileSync(GRADLE_PATH, gradle, 'utf8')

// ── 3. Verify the result actually says what we think it does ───────────────
const verify = readFileSync(GRADLE_PATH, 'utf8')
const verifyBuildTypes = matchBlock(verify, verify.indexOf('buildTypes'))
const verifyBody = verify.slice(verifyBuildTypes[0], verifyBuildTypes[1] + 1)
const verifyRelease = matchBlock(verifyBody, verifyBody.indexOf('release'))
const verifyReleaseBody = verifyBody.slice(verifyRelease[0], verifyRelease[1] + 1)

if (!verifyReleaseBody.includes('signingConfig signingConfigs.release')) {
  fail('post-write verification failed — release build type is still not using the release signingConfig')
}
if (!verify.includes('storeType "PKCS12"')) {
  fail('post-write verification failed — release signingConfig was not written')
}

console.log('[inject-android-signing] OK — release builds will use the release keystore.')
