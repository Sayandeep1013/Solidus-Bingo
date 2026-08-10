#!/usr/bin/env node
/**
 * mobile-qa/simulate-players.mjs
 *
 * Drives additional "players" through the app's real backend API, signed in
 * as fixed test accounts (src/lib/testAccounts.ts), so a Maestro flow only
 * needs to physically drive ONE device while still exercising genuine
 * multiplayer/ranked server behavior. See the autonomous-mobile-qa skill
 * for the general pattern this implements.
 *
 * Usage:
 *   node mobile-qa/simulate-players.mjs join-room <ROOMCODE> <account>
 *   node mobile-qa/simulate-players.mjs ranked-queue <account> <capacity> <timeBankMs>
 *   node mobile-qa/simulate-players.mjs leave-queue <account>
 *   node mobile-qa/simulate-players.mjs call-number <account> <gameId> <number> <sequence>
 *   node mobile-qa/simulate-players.mjs claim-forfeit-win <account> <gameId>
 *   node mobile-qa/simulate-players.mjs claim-timeout-win <account> <gameId>
 *   node mobile-qa/simulate-players.mjs cast-forfeit-vote <account> <voteId> <YES|NO>
 *   node mobile-qa/simulate-players.mjs cancel-forfeit-vote <account> <voteId>
 *   node mobile-qa/simulate-players.mjs initiate-disconnect <account> <gameId> <disconnectedPlayerId>
 *
 * <account> is a short key: testbot1, testbot2, testbot3, or testbot4
 * (maps to testbot{N}@solidusbingo.test — see TEST_ACCOUNTS below, kept in
 * sync with src/lib/testAccounts.ts by hand since this script runs outside
 * the app bundle and can't import TS directly).
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const TEST_ACCOUNTS = {
  testbot1: 'testbot1@solidusbingo.test',
  testbot2: 'testbot2@solidusbingo.test',
  testbot3: 'testbot3@solidusbingo.test',
  testbot4: 'testbot4@solidusbingo.test',
}

function loadEnvLocal() {
  const envPath = join(PROJECT_ROOT, '.env.local')
  if (!existsSync(envPath)) {
    throw new Error(`.env.local not found at ${envPath}`)
  }
  const env = {}
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

async function signIn(supabase, accountKey) {
  const email = TEST_ACCOUNTS[accountKey]
  if (!email) {
    throw new Error(`Unknown test account "${accountKey}" — expected one of: ${Object.keys(TEST_ACCOUNTS).join(', ')}`)
  }
  const env = loadEnvLocal()
  const password = env.EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD
  if (!password) throw new Error('EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD not set in .env.local')

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`)
  return data.session
}

async function invoke(supabase, functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body })
  if (error) {
    let detail = error.message
    if (error.name === 'FunctionsHttpError' && error.context) {
      try { detail = JSON.stringify(await error.context.json()) } catch { /* ignore */ }
    }
    throw new Error(`${functionName} failed: ${detail}`)
  }
  return data
}

async function main() {
  const [, , action, ...args] = process.argv
  if (!action) {
    console.error('Usage: node simulate-players.mjs <action> [...args] — see file header for actions')
    process.exit(1)
  }

  const env = loadEnvLocal()
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY not set in .env.local')

  const supabase = createClient(supabaseUrl, anonKey)

  switch (action) {
    case 'join-room': {
      const [code, accountKey] = args
      if (!code || !accountKey) throw new Error('Usage: join-room <ROOMCODE> <account>')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'join-room', { code: code.toUpperCase() })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'ranked-queue': {
      const [accountKey, capacityStr, timeBankMsStr] = args
      const capacity = Number(capacityStr)
      const timeBankMs = Number(timeBankMsStr ?? 300_000)
      if (!accountKey || ![2, 3, 4].includes(capacity)) throw new Error('Usage: ranked-queue <account> <2|3|4> [timeBankMs]')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'join-queue', { capacity, time_bank_ms: timeBankMs })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'leave-queue': {
      const [accountKey] = args
      if (!accountKey) throw new Error('Usage: leave-queue <account>')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'leave-queue', {})
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'call-number': {
      const [accountKey, gameId, numberStr, sequenceStr] = args
      if (!accountKey || !gameId || !numberStr || !sequenceStr) {
        throw new Error('Usage: call-number <account> <gameId> <number> <sequence>')
      }
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'call-number', {
        game_id: gameId,
        number: Number(numberStr),
        sequence: Number(sequenceStr),
      })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'claim-forfeit-win': {
      const [accountKey, gameId] = args
      if (!accountKey || !gameId) throw new Error('Usage: claim-forfeit-win <account> <gameId>')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'claim-forfeit-win', { game_id: gameId })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'claim-timeout-win': {
      const [accountKey, gameId] = args
      if (!accountKey || !gameId) throw new Error('Usage: claim-timeout-win <account> <gameId>')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'claim-timeout-win', { game_id: gameId })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'cast-forfeit-vote': {
      const [accountKey, voteId, choice] = args
      if (!accountKey || !voteId || (choice !== 'YES' && choice !== 'NO')) {
        throw new Error('Usage: cast-forfeit-vote <account> <voteId> <YES|NO>')
      }
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'cast-forfeit-vote', { vote_id: voteId, choice })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'initiate-disconnect': {
      const [accountKey, gameId, disconnectedPlayerId] = args
      if (!accountKey || !gameId || !disconnectedPlayerId) {
        throw new Error('Usage: initiate-disconnect <account> <gameId> <disconnectedPlayerId>')
      }
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'initiate-disconnect-resolution', {
        game_id: gameId, disconnected_player_id: disconnectedPlayerId,
      })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'cancel-forfeit-vote': {
      const [accountKey, voteId] = args
      if (!accountKey || !voteId) throw new Error('Usage: cancel-forfeit-vote <account> <voteId>')
      await signIn(supabase, accountKey)
      const result = await invoke(supabase, 'cancel-forfeit-vote', { vote_id: voteId })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    default:
      throw new Error(`Unknown action "${action}"`)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
