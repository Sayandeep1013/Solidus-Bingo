# Solidus Bingo — Security Notes

Written during the "get functionality right first, security later" phase explicitly
requested for this friends-and-family project — so nothing here was treated as urgent
to fix during that phase. Read before any future public release.

This audit specifically answers: **is anything hardcoded directly in the app's own
client-side code** — i.e. baked into the JS bundle that ships inside the installed
APK, extractable by anyone who unzips/decompiles it, regardless of whether they can
see the GitHub repo at all.

---

## 1. Hardcoded directly in the app's client code (ships inside the APK)

| What | File | Bundled into which builds | Risk |
|---|---|---|---|
| QA test-account password (`Testing123!Bingo`) | `src/lib/testAccounts.ts` reads it from `EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD` | **development and preview only** — this env var is set in `eas.json`'s `development`/`preview` profiles but deliberately absent from `production`, so a production/store build never has it. A **preview** APK (the kind you'd hand to a friend to test) *does* have the plaintext password compiled directly into its JS bundle. | Low — these 4 accounts (`testbot1..4@solidusbingo.test`) have no elevated privilege, same RLS as any player. |
| QA test-account **emails** | `src/lib/testAccounts.ts`, `TEST_ACCOUNTS` array | **Every build, including production.** The module is imported unconditionally by the login screen (only the *button that uses it* is hidden behind the env flag), so the 4 email addresses themselves are literal strings in every shipped bundle, even though the password needed to actually sign in as them is empty/absent in production. | Very low — just 4 email addresses, no working credential alongside them in a production build. |
| Supabase project URL + anon key | `.env.local` → inlined via `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Every build, including production. | **By design, not a bug** — see §3. |

**What is correctly absent from the app's client code** (checked every source file, not
just grepped for the word "secret"): `SUPABASE_SERVICE_ROLE_KEY` and
`GOOGLE_CLIENT_SECRET` never appear anywhere under `src/`, `app/`, or any file that
gets bundled into the app. They're referenced only inside `supabase/functions/*` —
Edge Function code that runs on Supabase's own servers and is never shipped to a
device at all.

**Fix before any real public launch** (skip for friends-and-family testing):
- Rotate `EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD`, or simplest: once you're done using the
  `autonomous-mobile-qa` testing workflow, delete the 4 test accounts, delete
  `src/lib/testAccounts.ts` and the "Dev Test Login" UI in `login.tsx`, and stop setting
  `EXPO_PUBLIC_ENABLE_TEST_LOGIN` anywhere. That removes both rows above entirely rather
  than just rotating them.

---

## 2. Also hardcoded in the repo, but server-side only — never shipped to the app

Different risk category from §1: this code runs on Supabase's infrastructure and is
never part of the app bundle a player installs. Still worth knowing, since the repo is
public (see §4) so the *source* is visible even though it never reaches a device:

| What | File | Value |
|---|---|---|
| Seed-endpoint shared token | `supabase/functions/dev-seed-test-accounts/index.ts` | `solidus-bingo-qa-seed` — lets anyone re-invoke the account-seeding function. Idempotent, only touches the 4 fixed test accounts. |
| Same test-account password, server-side copy | same file | Used when creating the 4 accounts via the Auth Admin API. Must match §1's client-side value for test-login to work — rotate both together if you rotate one. |

---

## 3. Exposed by design (this is normal, not a bug)

`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are meant to be public —
this is how every Supabase client app works. The anon key alone grants nothing; every
table's Row Level Security policy is the actual security boundary, not secrecy of this
key. This is fine as long as RLS stays correct — see §5.

---

## 4. Separate issue: the GitHub repo itself is public

Not an "in-app code" finding, but worth knowing since it changes urgency: confirmed via
the GitHub API that `github.com/Sayandeep1013/Solidus-Bingo` is a **public** repository.
Everything in §1 and §2 is visible to anyone browsing the repo right now, not just to
someone who decompiles a built APK. Checked `git log --all -p` across the *entire*
history (not just the current tree) — no service role key or Google client secret has
ever been committed, at any point.

---

## 5. Real gaps worth closing before any wider release (from Supabase's own advisor tool)

Not secrets, but the kind of thing that matters once this stops being just-friends-and-family:

- **Leaked password protection is disabled** in Supabase Auth (checks new passwords
  against HaveIBeenPwned). One toggle in the dashboard (Authentication → Policies)
  before real users pick real passwords.
- **A few `SECURITY DEFINER` SQL functions** (`is_room_member`, `handle_new_user`,
  `game_room_id`) are callable directly via the REST API (`/rest/v1/rpc/...`) by
  anyone, including unauthenticated requests. In practice they only return
  booleans/UUIDs derivable from already-visible room membership — not sensitive — but
  they weren't *intended* as a public API surface. Worth `REVOKE EXECUTE ... FROM anon,
  authenticated` on them if this ever needs a tighter posture.
- Several functions have a mutable `search_path` (a Postgres hardening best practice,
  not a known active exploit) — fix is adding `SET search_path = public` to each.

Re-run `mcp__supabase__get_advisors` (security + performance) before any public
launch — this reflects the state as of this session and can drift as the schema changes.

---

## Summary if you're skimming

**In the app's own code, ships in preview builds:** the test-account password
(`testAccounts.ts` / `EXPO_PUBLIC_TEST_ACCOUNT_PASSWORD`) — low real-world impact, but
real. **Production builds never include it.** **Already fine:** service role key,
Google client secret — never in any file the app bundles, verified across full git
history too. **Also true:** the repo itself is public, so source-level exposure exists
independent of what's compiled into any build. **Worth a look eventually:** the two
Supabase Auth/RLS hardening items in §5.
