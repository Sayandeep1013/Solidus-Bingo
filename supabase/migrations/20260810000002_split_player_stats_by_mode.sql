-- Split player_stats by party size (2/3/4 players), so a leaderboard rank
-- at one party size never mixes with another. Pre-launch data only — no
-- production users yet, so this recreates the table rather than attempting
-- a lossy data migration (the old rows don't record which capacity each
-- game was, so there's nothing meaningful to preserve).
--
-- Spec: .kiro/specs/bingo-disconnect-recovery/requirements.md §3.1

drop table if exists player_stats;

create table player_stats (
  player_id uuid not null references profiles(id) on delete cascade,
  capacity smallint not null check (capacity in (2, 3, 4)),
  games_played integer not null default 0,
  games_won integer not null default 0,
  primary key (player_id, capacity)
);

alter table player_stats enable row level security;

-- Matches the previous table's policy name/scope exactly (public select,
-- no role restriction — writes only ever happen via the service-role key
-- inside Edge Functions, same as before).
create policy "player_stats_select_public"
  on player_stats for select
  using (true);
