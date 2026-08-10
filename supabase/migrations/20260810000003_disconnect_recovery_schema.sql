-- Schema foundation for disconnect recovery, forfeiture, and time controls.
-- No behavior change yet — this just lays the ground for Phases 2-6.
--
-- Spec: .kiro/specs/bingo-disconnect-recovery/design.md §2

-- rooms: time control config
alter table rooms
  add column time_bank_ms integer not null default 300000, -- 5 min placeholder default
  add column disconnect_grace_ms integer not null default 30000;

alter table rooms
  add constraint rooms_time_bank_positive check (time_bank_ms > 0);
alter table rooms
  add constraint rooms_disconnect_grace_positive check (disconnect_grace_ms > 0);

-- matchmaking_queue: time bank becomes a second matching dimension
alter table matchmaking_queue
  add column time_bank_ms integer not null default 300000;

alter table matchmaking_queue
  add constraint matchmaking_queue_time_bank_positive check (time_bank_ms > 0);

-- games: explicit turn-start marker (NOT the auto-updated_at trigger column,
-- which the games_set_updated_at trigger stamps on every write regardless
-- of whether the turn actually changed)
alter table games
  add column turn_started_at timestamptz null;

-- game_players: per-player clock + out-of-rotation state
alter table game_players
  add column time_remaining_ms integer not null default 0,
  add column is_out boolean not null default false,
  add column out_reason text null,
  add column bot_controlled boolean not null default false;

alter table game_players
  add constraint game_players_time_remaining_non_negative check (time_remaining_ms >= 0);
alter table game_players
  add constraint game_players_out_reason_valid
    check (out_reason in ('TIMEOUT', 'FORFEIT_VOTE', 'SELF_FORFEIT') or out_reason is null);

-- forfeit votes (2p uses the same tables with a single ballot expected,
-- rather than a separate mechanism — spec requirements.md D3)
create table forfeit_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  target_player_id uuid not null references profiles(id),
  status text not null default 'PENDING' check (status in ('PENDING', 'PASSED', 'FAILED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz null
);

-- Only one PENDING vote per (game, target) at a time — dedupes concurrent
-- initiate-disconnect-resolution calls down to a single vote row. A later
-- disconnect of the same player, after an earlier vote already resolved,
-- is free to start a fresh vote since the earlier row is no longer PENDING.
create unique index forfeit_votes_one_pending_per_target
  on forfeit_votes (game_id, target_player_id)
  where status = 'PENDING';

create table forfeit_vote_ballots (
  vote_id uuid not null references forfeit_votes(id) on delete cascade,
  voter_player_id uuid not null references profiles(id),
  choice text not null check (choice in ('YES', 'NO')),
  voted_at timestamptz not null default now(),
  primary key (vote_id, voter_player_id)
);

alter table forfeit_votes enable row level security;
alter table forfeit_vote_ballots enable row level security;

-- Readable by anyone authenticated (matches player_stats' public-read
-- posture) — writes only ever happen via the service-role key inside Edge
-- Functions, same as every other table in this schema.
create policy "forfeit_votes_select_public"
  on forfeit_votes for select
  using (true);

create policy "forfeit_vote_ballots_select_public"
  on forfeit_vote_ballots for select
  using (true);

-- result-seen tracking (Req 3.8.4) — set once a player has viewed the
-- outcome of a game that finished while they weren't present for it, so
-- the "while you were away" notification only ever shows once.
alter table room_players
  add column result_seen_at timestamptz null;
