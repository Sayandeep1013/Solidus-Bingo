# Solidus Bingo

A real-time multiplayer Bingo game — Expo/React Native app backed by Supabase.

## Stack
- Frontend: Expo (React Native), Expo Router, TypeScript, Zustand
- Backend: Supabase (Postgres, Auth, Realtime, Edge Functions)
- Distribution: EAS Build (Android APK / AAB)

## Getting Started

```bash
npm install
npx expo start
```

Copy `.env.local.example` (or see `SECURITY_NOTES.md`) for the required
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` values.

## Project Structure

```
app/                # Expo Router screens
src/
  components/        # UI components
  hooks/              # Realtime subscriptions and derived state
  lib/                 # Supabase client, game engine, helpers
  store/               # Zustand stores
  theme/               # Design tokens
supabase/
  functions/           # Edge Functions (Deno)
  migrations/          # Database migrations
mobile-qa/           # Maestro flows + multi-player simulation for on-device QA
```

## Releasing

Push a `v*` tag. That runs `.github/workflows/build-apk-github.yml`, which
lints, tests, then builds a signed APK on GitHub's own runners and publishes it
as a GitHub Release. Bump `expo.version` **and** `expo.android.versionCode` in
`app.json` first — Android refuses to install over a build with a higher
versionCode, and the update gate below compares versions.

`.github/workflows/release-apk.yml` does the same via EAS Build and is the
manual fallback for when the Gradle path is what's broken.

## Getting a fix to people who already installed

The APK is sideloaded, so Android will never update anyone automatically. Two
levers, and they cover different things.

**JS-only fix → ship an OTA.** Run the `OTA Update` workflow. It publishes a new
JavaScript bundle that installed apps pick up in the background and apply on
their next launch, with no reinstall. It cannot deliver anything native — a new
native module, or a change to `app.json`'s splash/icon/permissions/version. Rule
of thumb: if `npx expo prebuild` would emit different Android files, an OTA
can't carry it. Updates are scoped by `runtimeVersion` (policy `appVersion`), so
each app version needs its own publish.

**Must-reinstall → raise the floor.** `public.app_config.min_supported_version`
is the oldest version still allowed to run. Anything below it gets a blocking
"update required" screen instead of the app:

```sql
UPDATE public.app_config SET min_supported_version = '1.0.2';
```

Seeded at `0.0.0`, i.e. off, because turning it on locks people out of a working
app. It only governs builds that already contain the gate — **1.0.2 and later**.
Anyone on 1.0.0 or 1.0.1 has no gate code and must be asked to reinstall by
hand, once.

### What a backend change reaches, and what it doesn't

Everything in `supabase/` — schema, RLS, Edge Functions — is one shared copy.
Deploy it and **every install is affected immediately, old APKs included**;
nobody updates anything. Everything in `app/` and `src/` is frozen into each
APK and only changes when that person installs a new one, or gets an OTA.

The corollary is the dangerous half: a backend change can break every old
install without touching their phones. Until the gate has been raised at least
once, treat Edge Function responses as append-only — add fields, never rename
or remove them.
