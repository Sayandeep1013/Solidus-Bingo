/**
 * Edge Function: dev-seed-test-accounts
 *
 * One-time (idempotent) provisioning of fixed QA test accounts used by the
 * autonomous mobile-qa flows and simulate-players.ts. Creates each account
 * via the Auth Admin API (email pre-confirmed, so no confirmation email is
 * needed) and sets a known username on its profile.
 *
 * This is a setup utility, not part of the app's runtime API surface — it
 * is gated by a fixed shared token (not a "real" secret store, just enough
 * to stop randos from hammering the endpoint) rather than requiring a
 * caller JWT, since it runs before any test account exists to authenticate
 * as. Safe to re-run any number of times.
 *
 * Invoke once manually:
 *   curl -X POST https://<ref>.supabase.co/functions/v1/dev-seed-test-accounts \
 *     -H "apikey: <anon key>" -H "x-seed-token: solidus-bingo-qa-seed"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SEED_TOKEN = 'solidus-bingo-qa-seed'
const TEST_ACCOUNT_PASSWORD = 'Testing123!Bingo'

const TEST_ACCOUNTS = [
  { email: 'testbot1@solidusbingo.test', username: 'TestBot1' },
  { email: 'testbot2@solidusbingo.test', username: 'TestBot2' },
  { email: 'testbot3@solidusbingo.test', username: 'TestBot3' },
  { email: 'testbot4@solidusbingo.test', username: 'TestBot4' },
]

Deno.serve(async (req: Request) => {
  if (req.headers.get('x-seed-token') !== SEED_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const results: Record<string, string> = {}

  for (const account of TEST_ACCOUNTS) {
    // Look up by listing — admin API has no direct getUserByEmail
    const { data: existingList } = await admin.auth.admin.listUsers()
    const existing = existingList?.users.find((u) => u.email === account.email)

    let userId: string
    if (existing) {
      userId = existing.id
      results[account.email] = 'already existed'
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: account.email,
        password: TEST_ACCOUNT_PASSWORD,
        email_confirm: true,
      })
      if (createError || !created.user) {
        results[account.email] = `create failed: ${createError?.message}`
        continue
      }
      userId = created.user.id
      results[account.email] = 'created'
    }

    // Profile row is auto-created by the on_auth_user_created trigger with a
    // NULL username — set it explicitly here (bypasses the uniqueness check
    // since these are fixed, pre-agreed names).
    await admin.from('profiles').update({ username: account.username }).eq('id', userId)
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
