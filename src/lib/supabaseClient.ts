/**
 * Supabase client — Expo + SecureStore adapter
 *
 * Rules enforced here:
 * - detectSessionInUrl: false (REQUIRED for React Native — URL is handled manually)
 * - Tokens stored in SecureStore only — never AsyncStorage
 *
 * NOTE on heartbeat/reconnection:
 * The mobile silent-disconnect handler (iOS/Android backgrounding drops WebSocket)
 * is NOT configured here as a constructor option — it doesn't exist on
 * RealtimeClientOptions in @supabase/supabase-js v2.
 *
 * Instead, reconnection is handled in Phase 6 (useRealtimeChannel hook) by:
 *   1. Watching the channel subscription status for 'CHANNEL_ERROR' / 'TIMED_OUT'
 *   2. Calling supabase.realtime.disconnect() + connect() in the status callback
 *   3. Using AppState (foreground/background) events to detect silent drops
 *
 * This is the correct Supabase JS v2 pattern — see src/hooks/useRealtimeChannel.ts
 */
import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'

// Adapter that maps Supabase's storage API to Expo SecureStore
// Tokens are NEVER written to AsyncStorage (spec bingo-authentication §Req 11)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      // REQUIRED for React Native — deep links are handled manually
      // via handleDeepLink() in src/lib/auth.ts. Do NOT set to true.
      detectSessionInUrl: false,
    },
  }
)
