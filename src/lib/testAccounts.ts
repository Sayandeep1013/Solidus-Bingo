/**
 * src/lib/testAccounts.ts
 *
 * QA-only test account roster, used by the "Dev Test Login" button on the
 * login screen and by mobile-qa/simulate-players.ts (outside the app
 * bundle) to drive additional players via the API.
 *
 * TEST_LOGIN_ENABLED is inlined at build time from EXPO_PUBLIC_ENABLE_TEST_LOGIN
 * (set in .env.local for local dev, and in eas.json's development/preview
 * profiles — deliberately absent from the production profile, so the
 * "Dev Test Login" UI never renders in a build a real player would install).
 *
 * These accounts have no elevated privileges — they're normal profiles,
 * indistinguishable server-side from any other player.
 */
export const TEST_LOGIN_ENABLED = process.env.EXPO_PUBLIC_ENABLE_TEST_LOGIN === 'true'

export const TEST_ACCOUNT_PASSWORD = process.env.EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD ?? ''

export const TEST_ACCOUNTS = [
  { email: 'testbot1@solidusbingo.test', username: 'TestBot1' },
  { email: 'testbot2@solidusbingo.test', username: 'TestBot2' },
  { email: 'testbot3@solidusbingo.test', username: 'TestBot3' },
  { email: 'testbot4@solidusbingo.test', username: 'TestBot4' },
] as const
