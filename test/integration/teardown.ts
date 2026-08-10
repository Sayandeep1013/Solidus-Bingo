/**
 * test/integration/teardown.ts
 *
 * Global teardown for integration tests.
 * Truncates all test-created rows without dropping schema.
 * Spec: bingo-testing Req 1.6
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Tables in deletion order (respect FK deps — children first)
const TRUNCATE_ORDER = [
  'rematch_votes',
  'game_results',
  'game_completed_lines',
  'game_calls',
  'game_boards',
  'game_players',
  'games',
  'room_players',
  'rooms',
  'profiles',
]

export default async function globalTeardown() {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  for (const table of TRUNCATE_ORDER) {
    try {
      // Delete all rows — CASCADE handles remaining child rows
      await admin.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    } catch (e) {
      console.warn(`[teardown] Could not truncate ${table}:`, e)
    }
  }

  console.log('✅ Integration test teardown complete')
}
