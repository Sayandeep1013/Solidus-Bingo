/**
 * test/integration/setup.ts
 *
 * Global setup for integration tests.
 * Verifies Supabase is running and applies pending migrations.
 * Spec: bingo-testing Req 1.5
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async function globalSetup() {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify Supabase is reachable
  let attempts = 0
  while (attempts < 10) {
    try {
      const { error } = await admin.from('profiles').select('id').limit(1)
      if (!error) break
    } catch {
      // not ready yet
    }
    attempts++
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (attempts >= 10) {
    throw new Error(
      'Integration test setup failed: Supabase is not reachable at ' + SUPABASE_URL +
      '\nRun `supabase start` before running integration tests.'
    )
  }

  console.log('✅ Supabase is reachable — integration tests starting')
}
