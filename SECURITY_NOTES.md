# Solidus Bingo — Security Notes

Written during the "get functionality right first, security later" phase explicitly
requested for this friends-and-family project. Nothing below was treated as urgent
during that phase, per that instruction — but **read the first section now**, because
it's not a "before you go public" item. It's already true today.

---

## 1. Already exposed today — the GitHub repo is public

`github.com/Sayandeep1013/Solidus-Bingo` is a **public** repository (confirmed via the
GitHub API while writing this doc). Anything committed to it is visible to anyone right
now, not just after some future "release."

Two real credentials are currently committed in plain text:

| What | Where | Value | Real-world risk today |
|---|---|---|---|
| QA test account password | `eas.json` (`development`/`preview` `env` blocks), `.env.local`* | `Testing123!Bingo` | Anyone can sign in as `testbot1..4@solidusbingo.test`. These accounts have **no elevated privileges** — they're normal player accounts, same RLS as everyone else. Worst case: someone plays a ranked game as "TestBot2" and pollutes the leaderboard with a fake result. |
| Seed-endpoint shared token | `supabase/functions/dev-seed-test-accounts/index.ts` | `solidus-bingo-qa-seed` | Lets anyone re-invoke the account-seeding function. It's idempotent (no-ops if the 4 accounts already exist) and only touches those 4 fixed accounts — can't create arbitrary users or touch real player data. |

\* `.env.local` itself is gitignored and was never committed — but the **same literal
value** is also in `eas.json`, which *is* committed, so the password is exposed via that
file regardless.

**Fix before any real public launch** (not needed for friends-and-family testing):
- Rotate `EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD` to a new value, update it in `.env.local`
  and `eas.json`, and re-run `dev-seed-test-accounts` to reset the 4 accounts' passwords
  (or delete them and reseed).
- Make the repo private, or move `eas.json`'s `env` values to EAS's own secret store
  (`eas secret:create`) instead of the committed file, and rotate the seed token similarly.
- Simplest alternative if you don't want to manage this at all: delete the 4 test
  accounts and the `dev-seed-test-accounts` function once you're done with the
  `autonomous-mobile-qa` testing workflow, and stop shipping `EXPO_PUBLIC_ENABLE_TEST_LOGIN`
  in any build profile.

---

## 2. Correctly NOT exposed (verified, not just assumed)

Checked `git log --all -p` across the full history, not just the current tree — these
have never been committed at any point:

- **`SUPABASE_SERVICE_ROLE_KEY`** — only ever referenced as `Deno.env.get(...)` inside
  Edge Functions (which run server-side on Supabase's infrastructure); the actual value
  lives only in Supabase's own Edge Function environment, never in this repo or the app bundle.
- **`GOOGLE_CLIENT_SECRET`** — never in code; lives only in the Supabase dashboard's Auth
  provider settings, per `AUTH_SETUP_GUIDE.md`.
- **`.env.local`** — gitignored (`.gitignore:...:.env.local`, verified with
  `git check-ignore -v`), never committed.

## 3. Exposed by design (this is normal, not a bug)

- **`EXPO_PUBLIC_SUPABASE_URL`** and **`EXPO_PUBLIC_SUPABASE_ANON_KEY`** are baked into
  every built APK and are meant to be public — this is how Supabase's client model works.
  The anon key alone grants nothing; every table's Row Level Security policy is the
  actual boundary. This is fine as long as RLS stays correct (see next section).

## 4. Real gaps worth closing before any wider release (found via Supabase's own advisor tool)

These aren't secrets, but they're the kind of thing that matters once this stops being
just-friends-and-family:

- **Leaked password protection is disabled** in Supabase Auth — Supabase can check
  new passwords against HaveIBeenPwned and currently doesn't. One toggle in the
  dashboard (Authentication → Policies) to turn on before real users pick real passwords.
- **A handful of `SECURITY DEFINER` SQL functions** (`is_room_member`,
  `handle_new_user`, `game_room_id`) are callable directly via the REST API
  (`/rest/v1/rpc/...`) by anyone, including unauthenticated (`anon`) requests. In
  practice these are read-only/trigger helpers that don't leak anything sensitive
  (they return booleans/UUIDs derivable from already-public-ish room membership), but
  they weren't *intended* as a public API surface — worth explicitly setting
  `REVOKE EXECUTE ... FROM anon, authenticated` on them if this ever needs a tighter
  security posture, or leaving as-is if the current behavior (derivable, non-sensitive
  data) is judged acceptable.
- Several functions have a mutable `search_path` (a Postgres hardening best-practice,
  not a known active exploit here) — fix is a one-line `SET search_path = public` added
  to each function definition.

Run `mcp__supabase__get_advisors` (security + performance) again before any public
launch — this list reflects the state as of this session and could drift as the schema
changes.

---

## Summary if you're skimming

**Do before going public, not urgent now:** rotate the test-account password and seed
token (section 1), or just delete the test-login machinery once mobile QA is done.
**Already fine:** service role key, Google client secret, `.env.local` — never leaked.
**Worth a look eventually:** the two Supabase Auth/RLS hardening items in section 4.
