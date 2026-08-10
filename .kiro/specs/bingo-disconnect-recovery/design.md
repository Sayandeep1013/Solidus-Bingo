# Disconnect Recovery, Forfeiture & Time Controls — Technical Design & Implementation Plan

Companion to `requirements.md` — read that first for the *what* and *why*.
This is the *how*: schema, the two genuinely hard architectural problems,
new Edge Functions, and a phased build order.

## 1. The two hard problems, solved once each

Everything else in this spec is mostly plumbing once these two are settled.

### 1.1 "Who enforces a clock running out, with no server-side ticking process?"

This app has no cron, no background worker — every state change happens
inside a client-triggered Edge Function call. A chess clock needs *something*
to notice zero has been hit even if the timed-out player never acts again.

**Design:** the server stores the objective truth (`games.turn_started_at`,
`game_players.time_remaining_ms`); *any* present client can independently
compute the deadline and, once it's passed, call an Edge Function to enforce
it — but the function re-derives elapsed time from the server's own stored
timestamp, never trusting the caller's claim that time is up. This makes it
safe for **any** client to be the one that reports it — a malicious or buggy
client claiming a false timeout gets rejected by the server's own math.

Two enforcement points cover both ways a timeout can go unnoticed:
- **The timed-out player tries to move anyway** → `call-number` checks their
  own deadline first and rejects+resolves-as-timeout instead of processing
  the call.
- **They never come back at all** → the *other* player's client renders a
  live local countdown (pure display math, no network calls to tick), and
  once it computes the deadline has passed, calls `claim-timeout-win`, which
  independently re-verifies before doing anything.

### 1.2 "Who plays the bot's moves when nobody's driving that seat?"

Same root constraint. **Design:** identical pattern — any present client,
on observing via Realtime that `games.active_player_id` is a
`bot_controlled` seat, waits a short randomized delay (mirroring the local
practice-bot's own "thinking" pause) and calls `submit-bot-move`. If two
clients race to submit for the same turn, that's not a new problem — it's
the *exact* race `call-number` already handles via its sequence-number
check (loser gets `CONCURRENT_CONFLICT`, discards silently).

**Where the bot "lives":** nowhere persistent — no server process, no bot
account, no background compute. `bot_controlled` is just a boolean on a
`game_players` row. The move itself is computed client-side by whichever
real player's device notices it's that seat's turn (same
`Math.random()`-over-uncalled-numbers logic the local practice-bot already
uses), then submitted through the normal API/Realtime pipeline — so it
syncs to everyone else exactly like any human move, no bot-specific sync
path needed. Any number of seats can be bot-controlled at once (each is
independent state); the only real constraint is that at least one human
has to be present to notice and trigger a given bot's move. A
bot-controlled seat's time bank keeps ticking down like normal — same
deduction regardless of whether the move came from the real player or the
bot standing in for them.

`submit-bot-move`
is a thin eligibility-check wrapper around the same core call-resolution
logic `call-number` uses, refactored into one shared internal function so
there's a single source of truth for scoring/line-detection/win-check
(mirrors the existing `finalizeRankedStats` sharing pattern already in the
codebase).

## 2. Schema changes

All additive/restructuring migrations, in one PR, applied together (they're
interdependent). Pre-launch data only — no production users yet, so
`player_stats` is recreated rather than data-migrated (per the project's
existing "friends and family, don't over-engineer this" posture).

```sql
-- player_stats: global → per-mode
drop table player_stats;
create table player_stats (
  player_id uuid not null references profiles(id) on delete cascade,
  capacity smallint not null check (capacity in (2,3,4)),
  games_played integer not null default 0,
  games_won integer not null default 0,
  primary key (player_id, capacity)
);

-- rooms: time control config
alter table rooms
  add column time_bank_ms integer not null default 300000, -- 5 min, placeholder default
  add column disconnect_grace_ms integer not null default 30000;

-- matchmaking_queue: time bank becomes a second matching dimension
alter table matchmaking_queue
  add column time_bank_ms integer not null default 300000;

-- games: explicit turn-start marker (NOT the auto-updated_at trigger column)
alter table games
  add column turn_started_at timestamptz null;

-- game_players: per-player clock + out-of-rotation state
alter table game_players
  add column time_remaining_ms integer not null default 0,
  add column is_out boolean not null default false,
  add column out_reason text null
    check (out_reason in ('TIMEOUT','FORFEIT_VOTE','SELF_FORFEIT') or out_reason is null),
  add column bot_controlled boolean not null default false;

-- forfeit votes (3-4p; 2p uses the same tables with a single ballot expected)
create table forfeit_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  target_player_id uuid not null references profiles(id),
  status text not null default 'PENDING' check (status in ('PENDING','PASSED','FAILED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  unique (game_id, target_player_id, status) -- dedupes concurrent initiate attempts down to one PENDING row
);

create table forfeit_vote_ballots (
  vote_id uuid not null references forfeit_votes(id) on delete cascade,
  voter_player_id uuid not null references profiles(id),
  choice text not null check (choice in ('YES','NO')),
  voted_at timestamptz not null default now(),
  primary key (vote_id, voter_player_id)
);

-- result-seen tracking (Req 3.8.4)
alter table room_players
  add column result_seen_at timestamptz null;
```

Note on the `forfeit_votes` unique constraint: it only enforces one *PENDING*
vote per (game, target) at a time — a resolved vote's row keeps its
PASSED/FAILED status permanently, so a later disconnect of the same player
later in the same game can start a fresh vote without conflicting.

## 3. Shared internal logic

New shared module (mirrors how `finalizeRankedStats` is currently duplicated
between `call-number` and `claim-forfeit-win` — worth actually factoring
into `_shared/` this time rather than copy-pasting a third time):

- `resolvePlayerOut(admin, gameId, playerId, reason)` — marks
  `game_players.is_out = true, out_reason = reason`; if this leaves exactly
  one non-out player in a 2-player game, resolves the game FINISHED with
  that player as winner (mirrors the existing win-path ordering: capture
  before nulling); in 3-4p, just updates rotation state and lets the game
  continue. Applies ranked stats via the now-per-mode `finalizeRankedStats`
  when appropriate.
- `advanceTurn` (already exists in `call-number`) gains an `is_out` filter —
  skip out players when computing the next active player.
- `resolveCall(admin, gameId, callerId, number, sequence)` — the actual
  scoring/line-detection/win-check body of today's `call-number`, extracted
  so `submit-bot-move` can call it too instead of duplicating ~150 lines.

## 4. Ranked matchmaking becomes 2-dimensional

`join-queue` currently matches purely on `capacity`. With time banks, two
players must agree on **both** capacity and time bank to be matched — same
as chess.com's queue buckets. This means queue wait times can grow,
especially for uncommon time-bank choices; that's an accepted tradeoff (see
requirements.md Open Question 3) rather than something to solve here (e.g.
no "closest available time bank" fuzzy-matching in this phase).

## 5. New / changed Edge Functions

| Function | Change |
|---|---|
| `get-leaderboard` | Add `capacity` param; query restructured `player_stats`. |
| `create-room` | Accept `time_bank_ms`; add the `ALREADY_IN_GAME` guard `join-queue` already has. |
| `join-room` | Add the same `ALREADY_IN_GAME` guard. |
| `join-queue` | Accept `time_bank_ms`; match on `(capacity, time_bank_ms)`. |
| `start-game` | Seed each `game_players.time_remaining_ms` from `rooms.time_bank_ms`; set initial `games.turn_started_at`. |
| `call-number` | Extract `resolveCall`; check the caller's own deadline before processing; set `turn_started_at` on every turn advance; skip `is_out` players in `advanceTurn`. |
| `claim-forfeit-win` | **Retired**, superseded by `claim-timeout-win` (precise, deadline-based) and the disconnect/vote flow below (presence-based) — the old flat 2-minute heuristic was strictly worse than both of its replacements. |
| `claim-timeout-win` *(new)* | Re-verifies `now() > turn_started_at + time_remaining_ms` for the active player server-side; if true, calls `resolvePlayerOut(..., 'TIMEOUT')`. |
| `initiate-disconnect-resolution` *(new)* | Called ~30s after a client observes a presence drop. Branches on `rooms.time_bank_ms`: ≤10 min → straight to `resolvePlayerOut(..., 'TIMEOUT')` style auto-forfeit (reusing the same helper, just a different trigger); >10 min → creates a `forfeit_votes` row (2p: single-ballot-expected vote; 3-4p: full vote). Idempotent via the unique constraint in §2. |
| `cast-forfeit-vote` *(new)* | Records a ballot. Immediate `PASSED` if all eligible voters have now voted YES; immediate `FAILED` on any NO. Otherwise stays `PENDING` until expiry. |
| `resolve-expired-vote` *(new)* | Called by any client once `expires_at` has passed on a still-`PENDING` vote. Applies the Open-Question-1 tie-break rule (currently: PASS unless at least one explicit NO was cast) and, on FAILED, sets `bot_controlled = true` on the target's `game_players` row. |
| `submit-bot-move` *(new)* | Validates caller is a genuine present player in the game and the target seat is `bot_controlled`; picks a random uncalled number; delegates to `resolveCall` attributed to the bot-controlled player's id. |
| `reclaim-seat` *(new)* | Called by a player's own client on reconnect if their seat is `bot_controlled`; clears the flag. |
| `forfeit-self` *(new)* | Immediate, no grace period — calls `resolvePlayerOut(..., 'SELF_FORFEIT')` for the caller. |
| `acknowledge-result` *(new)* | Sets `room_players.result_seen_at` — called when the player views the Result screen or dismisses the "while you were away" notification. |

## 6. Client changes (high level — not itemized per-file here)

- Home screen: "game in progress" banner (Req 3.8.1) + "while you were away"
  notification (Req 3.8.3), both driven by a boot-time query for
  unresolved active membership / unseen finished games.
- Game screen: live countdown for both players (pure client-side math off
  `turn_started_at` + `time_remaining_ms`, resynced whenever a Realtime
  update arrives); the tucked-away self-forfeit action (Req 3.7.2); the
  disconnect/vote UI (single prompt at 2p, tally+countdown at 3-4p); a
  passive "watch for bot-controlled seat's turn" effect that fires
  `submit-bot-move` after a randomized delay.
- Room/queue creation screens: time-bank preset picker alongside the
  existing party-size picker.
- Leaderboard: mode tabs nested under the existing Wins/Win-Rate tabs.

## 7. Phased implementation plan

Each phase is independently shippable and testable before starting the
next. Ordered by (value delivered) ÷ (complexity), not strictly by
dependency — Phase 2 in particular closes the worst user-facing gaps
(F1–F5) well before the much harder timer/vote/bot machinery is needed.

1. **Phase 0 — Leaderboard mode split.** Independent of everything else.
   Ships first per explicit instruction.
2. **Phase 1 — Schema foundation.** All migrations in §2, applied together.
   No behavior change yet — just lays the ground.
3. **Phase 2 — Self-forfeit, resume-on-reopen, result-seen notification,
   `ALREADY_IN_GAME` guard on create/join-room.** Closes F1–F5. Doesn't
   need time banks, presence, or voting at all.
4. **Phase 3 — Time bank core.** Room/queue creation UI, `start-game`
   seeding, `call-number` deadline checks, `claim-timeout-win`, live
   countdown UI. Ships a fully working chess-clock before disconnect
   handling exists at all (a player who simply never returns already
   times out under this phase alone).
5. **Phase 4 — Disconnect detection + grace period + simplified 2p
   prompt.** Builds on Phase 3's `resolvePlayerOut`.
6. **Phase 5 — 3-4p forfeit voting.** Vote tables, cast/resolve functions,
   tally UI.
7. **Phase 6 — Bot takeover.** The last and most novel piece, built last
   since it only matters once a vote can actually fail (Phase 5).

## 8. Self-review (per brainstorming checklist)

- **Placeholders:** none left in — every `TODO`-shaped gap became either a
  concrete design decision or an explicit Open Question in requirements.md.
- **Internal contradictions:** checked the "no response = deny" framing
  from the user's own words against Req 3.4.4's actual proposed behavior —
  found a real tension (literal reading creates an AFK-lock exploit) and
  surfaced it as Open Question 1 rather than silently picking one reading.
- **Scope drift:** push notifications and untimed mode were both
  explicitly requested-then-declined in this conversation — kept them
  listed under "out of scope" rather than silently dropped, so it's clear
  they were considered.
- **Ambiguous requirements:** the vote tie-break rule (Open Question 1) and
  exact numeric defaults (Open Question 2) are the two places a second
  implementer could reasonably build something different from what's
  written here — both called out explicitly rather than buried.
- **Unverified facts:** the "no server-side disconnect detection today"
  and "Leave Game doesn't call the server" claims were both checked
  directly against the current source (`presenceStore.ts`,
  `game/[gameId].tsx`) before being stated as findings, not assumed.
