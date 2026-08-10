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

## Building a release APK

```bash
eas build --platform android --profile apk-release
```

Or push a `v*` tag / trigger `.github/workflows/release-apk.yml` manually to
build and publish it as a GitHub Release automatically.
