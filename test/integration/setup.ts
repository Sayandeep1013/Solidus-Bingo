/**
 * test/integration/setup.ts
 *
 * Global setup for integration tests.
 * Verifies Supabase is running and applies pending migrations.
 * Spec: bingo-testing Req 1.5
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async function globalSetup() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Integration test setup failed: SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify Supabase is reachable. Generous budget (~30s) — a CI runner
  // fresh off `supabase start` can be briefly slow to answer even with
  // nothing else contending for CPU. Every attempt's failure reason is
  // logged (not swallowed) — a silent retry loop turned a real, fixable
  // error (wrong URL, bad key, RLS denial, whatever it turns out to be)
  // into an opaque "not reachable" that took several blind guesses to
  // even start narrowing down.
  const MAX_ATTEMPTS = 20
  let attempts = 0
  let lastFailureDetail = '(no attempt completed)'
  while (attempts < MAX_ATTEMPTS) {
    try {
      const { error } = await admin.from('profiles').select('id').limit(1)
      if (!error) break
      lastFailureDetail = `Supabase error: ${JSON.stringify(error)}`
    } catch (err) {
      lastFailureDetail = `Thrown: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    }
    attempts++
    console.log(`[setup] attempt ${attempts}/${MAX_ATTEMPTS} failed — ${lastFailureDetail}`)
    await new Promise((r) => setTimeout(r, 1500))
  }

  if (attempts >= MAX_ATTEMPTS) {
    throw new Error(
      'Integration test setup failed: Supabase is not reachable at ' + SUPABASE_URL +
      `\nLast failure: ${lastFailureDetail}` +
      '\nRun `supabase start` before running integration tests.'
    )
  }

  console.log('✅ Supabase is reachable — integration tests starting')
}
