# Disconnect Recovery, Forfeiture & Time Controls — Requirements

Status: **DRAFT — awaiting approval before implementation begins.**

## 0. Why this exists

Investigating a stuck-game bug (`claim-forfeit-win`, already shipped) surfaced a
cluster of related gaps in how the app handles a player leaving mid-game —
whether on purpose, by force-quitting, or by losing connection. This spec
covers the full system needed to close those gaps, replacing the crude
2-minute "anyone can claim after a flat cooldown" mechanic with something
closer to how chess.com and CS2/Valorant handle disconnects and surrenders,
per direct discussion with the user.

## 1. Findings — current state, verified against the code

| # | Gap | Where |
|---|---|---|
| F1 | No way to voluntarily forfeit/concede a game you're still connected to. | No such action exists anywhere in the client or backend. |
| F2 | The disconnected-overlay's "Leave Game" button doesn't forfeit anything — it only clears local state and navigates away. The server-side game stays `ACTIVE` with you still in it. | `app/(app)/game/[gameId].tsx` `handleLeaveOnDisconnect` |
| F3 | No resume-on-reopen. `roomId`/`gameId` live only in in-memory Zustand state; nothing rehydrates them from the server on boot. A player who closes and reopens the app while still `ACTIVE` in a game lands on Home with no way back in — regardless of how short the gap was. | `app/(app)/_layout.tsx` |
| F4 | No notification when a game finished while you weren't present to see it (e.g. opponent's forfeit claim landed while you were offline). You'd only find out by checking the leaderboard. | No such check exists |
| F5 | `create-room` / `join-room` don't check for an existing active game the way `join-queue` does — a player can end up `ACTIVE` in more than one room simultaneously, compounding F3. | `supabase/functions/create-room`, `join-room` |
| F6 | No server-side disconnect detection at all — Presence is client-ephemeral (Realtime-only, never written to Postgres), so nothing server-side can independently observe "this player is gone." | `src/store/presenceStore.ts` |
| F7 | Leaderboard is a single global ranking; the user wants it split by outcome (Wins / Win Rate) and then by party size (2/3/4), since a 4-player win and a 2-player win aren't really the same accomplishment. | `app/(app)/leaderboard.tsx`, `get-leaderboard` |

## 2. Scope decisions already made (confirmed with user)

- **D1 — Leaderboard split ships first**, as an independent, self-contained
  deliverable, before any of the timer/forfeit work.
- **D2 — Every game is timed.** No untimed/casual mode. One code path, no
  "does this game have a clock" branching throughout the codebase.
- **D3 — 2-player disconnect handling is simplified**, not a full vote:
  with only one other player, "voting" degenerates to that one player's
  decision, so it reuses the same underlying resolution logic as the
  3–4 player vote but surfaces as a single accept/deny prompt, not a
  tally UI.
- **D4 — Voting/bot-takeover only applies above a per-player time bank of
  10 minutes.** At or below that, a disconnect that isn't reconnected
  within the grace period is a plain auto-forfeit, no vote, matching
  chess.com's own behavior for shorter time controls.

## 3. Functional Requirements

### 3.1 Leaderboard mode split (D1 — ships first)

- Req 3.1.1: The leaderboard has two top-level views: **Most Wins** and
  **Best Win Rate** (already exists).
- Req 3.1.2: Each view is further split by party size: **2-Player**,
  **3-Player**, **4-Player**. A player's stats in one mode never affect
  their standing in another.
- Req 3.1.3: The "5+ games played" qualification for Win Rate applies
  **per mode** — a player needs 5+ ranked games *at that specific party
  size* to appear in that mode's Win Rate ranking, independent of how many
  games they've played at other sizes.
- Req 3.1.4: This requires per-mode stat storage, replacing the current
  single-row-per-player `player_stats` table (see design.md §1).

### 3.2 Time bank (chess-clock style, all party sizes)

- Req 3.2.1: At room-creation time (private room host) or ranked-queue
  time (each player individually, matched together — see Req 3.6),
  players choose a per-player time bank from presets, e.g. 3 / 5 / 10 /
  15 / 30 minutes (exact preset list is a design/UI decision, not a
  behavioral one).
- Req 3.2.2: A player's time bank counts down only while it is their
  turn. It is paused at all other times.
- Req 3.2.3: If a player's time bank reaches zero, they are immediately
  and unambiguously **out** — no vote, no grace period, this is an
  objective condition. They are removed from turn rotation (§3.5).
- Req 3.2.4: 2-player game, one player times out → the other player wins
  outright, same resolution as today's `claim-forfeit-win` win path.
- Req 3.2.5: 3–4 player game, one player times out → they're dropped from
  rotation, the rest continue playing normally (§3.5).

### 3.3 Disconnect detection & grace period

- Req 3.3.1: A disconnect is detected when a player's Presence entry
  drops from the room's Realtime channel, observed by any other present
  client (F6 means this must be client-observed, not server-detected —
  see design.md §2 for why that's still safe).
- Req 3.3.2: On detecting a disconnect, a 30-second grace period starts
  (configurable per room at creation, default 30s) during which nothing
  happens — this absorbs ordinary network blips and app backgrounding.
- Req 3.3.3: If the player reconnects within the grace period, nothing
  further happens; play continues normally.
- Req 3.3.4: If the grace period expires without reconnection, what
  happens next depends on D4 (the room's configured time bank):
  - Time bank ≤ 10 min/player: **auto-forfeit**, no vote (§3.5).
  - Time bank > 10 min/player: the forfeit-claim flow starts (§3.4).

### 3.4 Forfeit claim flow (post-grace-period, long games only)

- Req 3.4.1 (2-player, D3): The remaining player gets a single "Your
  opponent disconnected — claim the win?" prompt with a response window
  (e.g. 20s). Accept → disconnected player is forfeited, resolves exactly
  like the existing `claim-forfeit-win` win path. No response within the
  window is **not** an auto-deny here — see Req 3.4.4 below for why 2p
  differs from the 3-4p default-deny rule.
- Req 3.4.2 (3–4 player): All other currently-active (non-disconnected,
  non-already-forfeited) players get a timed vote: "Claim forfeit against
  [player]?" Each remaining player casts YES or NO within the vote
  window (e.g. 20s). The tally is visible live to all voters as it comes
  in.
- Req 3.4.3: Unanimous YES among all eligible voters → the disconnected
  player is forfeited and dropped from rotation (§3.5); the rest continue
  playing normally.
- Req 3.4.4: Any NO, **or** the window expiring before everyone has voted
  → the claim fails. A "no response counts as NO" rule (matching
  CS2/Valorant surrender votes) would mean a single AFK voter permanently
  blocks every future forfeit vote in a long game, which defeats the
  purpose of the feature — so **only explicit NO votes count as NO**;
  players who haven't responded when the window closes are simply
  excluded from that tally. If literally everyone who does respond votes
  YES, the claim still passes even if not all eligible voters responded.
  **This is a deliberate deviation from the user's literal "no response =
  deny" framing — flagged for explicit confirmation, see Open Questions.**
- Req 3.4.5: If the disconnected player reconnects at any point before a
  vote concludes, the vote is cancelled immediately — no forfeit, no bot
  takeover, they simply resume play.

### 3.5 Bot takeover (vote failed, player still gone)

- Req 3.5.1: If a forfeit vote fails (§3.4.4) and the disconnected player
  still hasn't reconnected, their seat becomes bot-controlled.
- Req 3.5.2: On the bot-controlled seat's turn, a random uncalled number
  is played on their behalf after a short delay (mirroring the existing
  local practice-bot's "thinking" delay), so their board still
  accumulates lines/calls like a real player's.
- Req 3.5.3: The moment the real player reconnects, they immediately
  regain control — no re-vote, no waiting for their next turn to "kick
  in." If it's currently the bot's (their) turn when they reconnect, they
  take over that turn directly rather than the bot playing it.
- Req 3.5.4: A new disconnect (of the same or a different player) after
  bot-takeover has begun is handled the same way as any other disconnect
  (§3.3) — bot-takeover doesn't prevent further forfeit votes on other
  players.

### 3.6 Turn rotation with players out

- Req 3.6.1: Whether a player leaves rotation via timeout (§3.2), a
  passed forfeit vote (§3.4), or a self-forfeit (§3.7), the mechanism is
  the same: they're marked out, and turn order simply skips them from
  then on. No new mechanism per exit reason — one shared code path.
- Req 3.6.2: If the game is reduced to exactly one remaining
  non-forfeited player, no special-case win is needed — turn rotation
  naturally gives them every turn, and they resolve the game normally by
  reaching 5 lines through the existing win-check logic.

### 3.7 Self-forfeit / voluntary leave

- Req 3.7.1: A connected player can voluntarily forfeit at any time
  during an active game they don't want to continue. This is immediate —
  no grace period, no vote (you chose it yourself).
- Req 3.7.2: The action is available but deliberately **not** placed at
  the primary point of interaction (not next to the board, not a
  prominent button) — tucked into a secondary/confirmation-gated spot so
  it can't be hit by accident.
- Req 3.7.3: 2-player game → opponent wins outright. 3–4 player game →
  same "drop from rotation, others continue" resolution as §3.6.

### 3.8 Resume on reopen / notifications

- Req 3.8.1: On app open, if the player has an `ACTIVE` game they're
  still a live participant in (not yet forfeited/timed-out/left), Home
  shows a banner: "You have a game in progress" with a way to jump
  straight back into it.
- Req 3.8.2: Tapping through resumes exactly like a fresh game-screen
  entry (fetch current state, render) — if the game has actually just
  finished (race with a forfeit resolving moments earlier), the existing
  FINISHED/ABANDONED redirect in `GameScreen` handles it automatically;
  no separate resume-specific redirect logic needed.
- Req 3.8.3: On app open, if the player was a participant in a game that
  finished while they weren't present to see it, show an in-app
  notification/banner summarizing the outcome (win/loss/forfeited-out/
  timed-out). **In-app only** — no OS push notifications in this phase
  (confirmed with user).
- Req 3.8.4: A game's outcome is only surfaced this way once — a
  persisted "seen" flag prevents the same notice reappearing on every
  subsequent app open.
- Req 3.8.5: If a player has more than one stale `ACTIVE` membership
  (possible today per F5, and fixed going forward by Req 3.9), the most
  recently active one is shown.

### 3.9 Guard against re-entering the stuck state

- Req 3.9.1: `create-room` and `join-room` gain the same
  `ALREADY_IN_GAME` check `join-queue` already has, so a player can't end
  up `ACTIVE` in a second room while still stuck in a first one.

## 4. Explicitly out of scope for this spec

- OS-level push notifications (Req 3.8.3 is in-app only).
- Untimed/casual games (D2).
- Spectator mode, rematch-specific time-bank renegotiation, mid-game time
  bank changes.
- Anti-cheat around the bot-takeover move selection (it's uniform random,
  matching the existing local practice bot — not trying to play well).

## 5. Open questions for user confirmation

1. **Req 3.4.4** deliberately changes "no response = deny" (as literally
   stated) to "no response = excluded from tally, doesn't block a
   unanimous-among-responders pass." Reasoning: literal default-deny
   means one AFK voter permanently blocks the feature for the rest of
   the game, which seems to work against the point of having it. Please
   confirm this reading is what you want, or say if you actually want
   the stricter literal version despite the AFK-lock risk.
2. Exact numeric defaults — grace period 30s, vote window ~20s, time bank
   presets (3/5/10/15/30 min?) — proposed above, open to adjustment.
3. Ranked matchmaking currently matches on party size only. Time bank
   becomes a second matching dimension (see design.md §4) — confirming
   you're OK with ranked queue wait times potentially growing as a
   result of needing both dimensions to match.
