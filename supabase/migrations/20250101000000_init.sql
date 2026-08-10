-- =============================================================================
-- Solidus Bingo — Complete Initial Schema
-- Migration: 20250101000000_init.sql
--
-- Tables (in creation order to satisfy FK deps):
--   1. profiles
--   2. rooms
--   3. room_players
--   4. games
--   5. game_players
--   6. game_boards
--   7. game_calls
--   8. game_completed_lines
--   9. game_results
--  10. rematch_votes
--
-- Also creates:
--   - ENUM-like CHECK constraints (using text + CHECK, not PG ENUM, for schema flexibility)
--   - All indexes (unique partial + performance)
--   - Trigger functions: set_updated_at, prevent_update, prevent_capacity_update
--   - Auto-create profile on auth.users INSERT
--   - Row Level Security (RLS) policies — DENY ALL default, then explicit SELECTs
--   - Helper functions: is_room_member(), game_room_id() — each defined right
--     after the table it queries exists (LANGUAGE sql functions are validated
--     against real catalog objects at CREATE time, unlike plpgsql — defining
--     them before their table exists fails the whole migration outright, so
--     each is placed just above the first RLS policy that needs it rather
--     than grouped with the other trigger-function helpers up top)
--   - Realtime publication for relevant tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger function (reused by profiles, rooms, games)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: generic immutability trigger (prevents UPDATE on immutable tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are immutable and cannot be updated', TG_TABLE_NAME;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: prevent capacity update on rooms after creation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_capacity_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.capacity <> OLD.capacity THEN
    RAISE EXCEPTION 'rooms.capacity is immutable and cannot be changed after creation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: prevent layout update on game_boards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_layout_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS DISTINCT FROM OLD.layout THEN
    RAISE EXCEPTION 'game_boards.layout is immutable and cannot be changed after creation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Auto-create profile on auth.users INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    NULL,  -- username is NULL until Profile_Setup_Screen completes (two-phase setup)
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- TABLE 1: profiles
-- =============================================================================
CREATE TABLE public.profiles (
  id          uuid        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text        NULL,
  avatar_url  text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- username must be non-empty when set
  CONSTRAINT profiles_username_nonempty
    CHECK (username IS NULL OR char_length(username) >= 1),

  -- username length 1–30
  CONSTRAINT profiles_username_length
    CHECK (username IS NULL OR char_length(username) BETWEEN 1 AND 30),

  -- username character set: alphanumeric, underscore, hyphen
  CONSTRAINT profiles_username_chars
    CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_-]+$')
);

-- Case-insensitive unique index (NULL excluded — permits multiple NULL usernames)
CREATE UNIQUE INDEX profiles_username_ci_unique
  ON public.profiles(lower(username))
  WHERE username IS NOT NULL;

-- Updated_at trigger
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Public read — any authenticated or anon user can read profiles
CREATE POLICY "profiles_select_public"
  ON public.profiles FOR SELECT
  USING (true);

-- A user can only insert their own profile row
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- A user can only update their own profile row
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- =============================================================================
-- TABLE 2: rooms
-- =============================================================================
CREATE TABLE public.rooms (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  host_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  capacity    smallint    NOT NULL,
  status      text        NOT NULL DEFAULT 'CREATED',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz NULL,

  CONSTRAINT rooms_capacity_valid
    CHECK (capacity IN (2, 3, 4)),

  CONSTRAINT rooms_status_valid
    CHECK (status IN ('CREATED','WAITING','FULL','IN_GAME','GAME_FINISHED','REMATCH_WAITING','CLOSED')),

  -- Room code: 6 chars, charset A-H J-N P-T V-Z 2-9 (excludes O, I, U, 0, 1)
  CONSTRAINT rooms_code_format
    CHECK (code ~ '^[A-HJ-NP-TV-Z2-9]{6}$')
);

-- Unique room code among non-closed rooms
CREATE UNIQUE INDEX rooms_code_active_unique
  ON public.rooms(code)
  WHERE status <> 'CLOSED';

-- Performance indexes
CREATE INDEX rooms_code_idx      ON public.rooms(code);
CREATE INDEX rooms_host_id_idx   ON public.rooms(host_id);
CREATE INDEX rooms_status_idx    ON public.rooms(status);

-- Updated_at trigger
CREATE TRIGGER rooms_set_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Capacity immutability trigger
CREATE TRIGGER rooms_prevent_capacity_update
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.prevent_capacity_update();

-- =============================================================================
-- TABLE 3: room_players
-- (created here, before rooms' own RLS policies, because those policies call
-- is_room_member() below, which queries this table — see header note)
-- =============================================================================
CREATE TABLE public.room_players (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  join_order  smallint    NOT NULL,
  status      text        NOT NULL DEFAULT 'ACTIVE',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz NULL,

  CONSTRAINT room_players_status_valid
    CHECK (status IN ('ACTIVE','LEFT','KICKED')),

  CONSTRAINT room_players_join_order_positive
    CHECK (join_order > 0)
);

-- At most one ACTIVE record per player per room
CREATE UNIQUE INDEX room_players_active_unique
  ON public.room_players(room_id, player_id)
  WHERE status = 'ACTIVE';

-- Performance indexes
CREATE INDEX room_players_room_status_idx ON public.room_players(room_id, status);
CREATE INDEX room_players_player_id_idx   ON public.room_players(player_id);

-- ---------------------------------------------------------------------------
-- Helper: check if a user is an ACTIVE member of a given room
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_players
    WHERE room_id = p_room_id
      AND player_id = p_user_id
      AND status = 'ACTIVE'
  );
$$;

-- RLS: rooms
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Member read: user can see rooms they belong to
CREATE POLICY "rooms_select_member"
  ON public.rooms FOR SELECT
  USING (public.is_room_member(id, auth.uid()));

-- Pre-join read: any authenticated user can look up a room by code (to join)
CREATE POLICY "rooms_select_by_code"
  ON public.rooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- No direct INSERT/UPDATE/DELETE from client — Edge Functions use service role

-- RLS: room_players
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

-- A user can see all room_players rows for rooms they are ACTIVE members of
CREATE POLICY "room_players_select_member"
  ON public.room_players FOR SELECT
  USING (public.is_room_member(room_id, auth.uid()));

-- No direct INSERT/UPDATE/DELETE from client

-- =============================================================================
-- TABLE 4: games
-- =============================================================================
CREATE TABLE public.games (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  game_number       smallint    NOT NULL,
  status            text        NOT NULL DEFAULT 'CREATED',
  active_player_id  uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_id         uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  winning_call      smallint    NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz NULL,
  finished_at       timestamptz NULL,

  CONSTRAINT games_status_valid
    CHECK (status IN ('CREATED','LOBBY','STARTING','ACTIVE','FINISHED','CANCELLED','ABANDONED')),

  CONSTRAINT games_game_number_positive
    CHECK (game_number > 0),

  CONSTRAINT games_winning_call_range
    CHECK (winning_call IS NULL OR winning_call BETWEEN 1 AND 25),

  UNIQUE (room_id, game_number)
);

-- Only one game in ACTIVE/LOBBY/STARTING/REMATCH state per room
CREATE UNIQUE INDEX games_one_active_per_room
  ON public.games(room_id)
  WHERE status IN ('LOBBY','STARTING','ACTIVE');

-- Performance indexes
CREATE INDEX games_room_status_idx      ON public.games(room_id, status);
CREATE INDEX games_room_game_number_idx ON public.games(room_id, game_number);

-- Updated_at trigger
CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: get room_id for a given game_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_room_id(p_game_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT room_id FROM public.games WHERE id = p_game_id;
$$;

-- RLS
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- User can see games for rooms they are ACTIVE members of
CREATE POLICY "games_select_member"
  ON public.games FOR SELECT
  USING (public.is_room_member(room_id, auth.uid()));

-- No direct INSERT/UPDATE from client

-- =============================================================================
-- TABLE 5: game_players
-- =============================================================================
CREATE TABLE public.game_players (
  id              uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  turn_order      smallint    NOT NULL,
  score           smallint    NOT NULL DEFAULT 0,
  joined_game_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_players_turn_order_positive
    CHECK (turn_order > 0),

  CONSTRAINT game_players_score_non_negative
    CHECK (score >= 0),

  CONSTRAINT game_players_score_max
    CHECK (score <= 12),

  UNIQUE (game_id, player_id),
  UNIQUE (game_id, turn_order)
);

-- Performance indexes
CREATE INDEX game_players_game_turn_idx ON public.game_players(game_id, turn_order);
CREATE INDEX game_players_player_idx    ON public.game_players(player_id);

-- RLS
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;

-- User can see game_players for games in rooms they are ACTIVE members of
CREATE POLICY "game_players_select_member"
  ON public.game_players FOR SELECT
  USING (public.is_room_member(public.game_room_id(game_id), auth.uid()));

-- No direct INSERT/UPDATE from client

-- =============================================================================
-- TABLE 6: game_boards
-- =============================================================================
CREATE TABLE public.game_boards (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  layout      jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (game_id, player_id),

  -- Board layout must be a 25-element JSON array
  CONSTRAINT game_boards_layout_length
    CHECK (jsonb_array_length(layout) = 25)
);

-- Performance indexes
CREATE INDEX game_boards_game_id_idx        ON public.game_boards(game_id);
CREATE INDEX game_boards_game_player_idx    ON public.game_boards(game_id, player_id);

-- Immutability trigger: layout cannot be changed after insertion
CREATE TRIGGER game_boards_prevent_layout_update
  BEFORE UPDATE ON public.game_boards
  FOR EACH ROW EXECUTE FUNCTION public.prevent_layout_update();

-- RLS
ALTER TABLE public.game_boards ENABLE ROW LEVEL SECURITY;

-- A player can only read their OWN board (boards are private)
CREATE POLICY "game_boards_select_own"
  ON public.game_boards FOR SELECT
  USING (
    player_id = auth.uid()
    AND public.is_room_member(public.game_room_id(game_id), auth.uid())
  );

-- No direct INSERT/UPDATE from client

-- =============================================================================
-- TABLE 7: game_calls
-- =============================================================================
CREATE TABLE public.game_calls (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  caller_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  number      smallint    NOT NULL,
  sequence    smallint    NOT NULL,
  called_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_calls_number_range
    CHECK (number BETWEEN 1 AND 25),

  CONSTRAINT game_calls_sequence_positive
    CHECK (sequence > 0),

  -- Each number called at most once per game
  UNIQUE (game_id, number),

  -- Each sequence value used at most once per game
  UNIQUE (game_id, sequence)
);

-- Performance indexes
CREATE INDEX game_calls_sequence_idx ON public.game_calls(game_id, sequence);
CREATE INDEX game_calls_number_idx   ON public.game_calls(game_id, number);

-- Immutability trigger: rows in game_calls cannot be updated
CREATE TRIGGER game_calls_prevent_update
  BEFORE UPDATE ON public.game_calls
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update();

-- RLS
ALTER TABLE public.game_calls ENABLE ROW LEVEL SECURITY;

-- ACTIVE members of the room can see all call rows for games in that room
CREATE POLICY "game_calls_select_member"
  ON public.game_calls FOR SELECT
  USING (public.is_room_member(public.game_room_id(game_id), auth.uid()));

-- No direct INSERT/DELETE from client

-- =============================================================================
-- TABLE 8: game_completed_lines
-- =============================================================================
CREATE TABLE public.game_completed_lines (
  id                      uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                 uuid        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id               uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  line_id                 text        NOT NULL,
  completing_call_sequence smallint   NOT NULL,
  completed_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_completed_lines_line_id_valid
    CHECK (line_id IN (
      'row_0','row_1','row_2','row_3','row_4',
      'col_0','col_1','col_2','col_3','col_4',
      'diag_main','diag_anti'
    )),

  CONSTRAINT game_completed_lines_sequence_positive
    CHECK (completing_call_sequence > 0),

  -- Each line for a player in a game is scored exactly once
  UNIQUE (game_id, player_id, line_id)
);

-- Performance indexes
CREATE INDEX game_completed_lines_player_idx  ON public.game_completed_lines(game_id, player_id);
CREATE INDEX game_completed_lines_call_idx    ON public.game_completed_lines(game_id, completing_call_sequence);

-- Immutability trigger
CREATE TRIGGER game_completed_lines_prevent_update
  BEFORE UPDATE ON public.game_completed_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update();

-- RLS
ALTER TABLE public.game_completed_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_completed_lines_select_member"
  ON public.game_completed_lines FOR SELECT
  USING (public.is_room_member(public.game_room_id(game_id), auth.uid()));

-- No direct INSERT from client

-- =============================================================================
-- TABLE 9: game_results
-- =============================================================================
CREATE TABLE public.game_results (
  id            uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       uuid        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  winner_id     uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  outcome       text        NOT NULL,
  final_scores  jsonb       NOT NULL,
  total_calls   smallint    NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT game_results_outcome_valid
    CHECK (outcome IN ('WINNER','CANCELLED','ABANDONED')),

  -- One result per game
  UNIQUE (game_id),

  CONSTRAINT game_results_total_calls_non_negative
    CHECK (total_calls >= 0),

  -- winner_id must be set when outcome is WINNER
  CONSTRAINT game_results_winner_required_for_win
    CHECK (outcome <> 'WINNER' OR winner_id IS NOT NULL)
);

-- Performance indexes
CREATE INDEX game_results_game_id_idx   ON public.game_results(game_id);
CREATE INDEX game_results_winner_id_idx ON public.game_results(winner_id);

-- Immutability trigger
CREATE TRIGGER game_results_prevent_update
  BEFORE UPDATE ON public.game_results
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update();

-- RLS
ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_results_select_member"
  ON public.game_results FOR SELECT
  USING (public.is_room_member(public.game_room_id(game_id), auth.uid()));

-- No direct INSERT from client

-- =============================================================================
-- TABLE 10: rematch_votes
-- =============================================================================
CREATE TABLE public.rematch_votes (
  id          uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_number smallint    NOT NULL,
  voted_at    timestamptz NOT NULL DEFAULT now(),

  -- One vote per player per room per game_number (idempotency guarantee)
  UNIQUE (room_id, player_id, game_number)
);

-- Performance index for vote-count queries scoped to current game session
CREATE INDEX rematch_votes_room_game_idx ON public.rematch_votes(room_id, game_number);

-- RLS
ALTER TABLE public.rematch_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rematch_votes_select_member"
  ON public.rematch_votes FOR SELECT
  USING (public.is_room_member(room_id, auth.uid()));

-- No direct INSERT/DELETE from client

-- =============================================================================
-- Realtime publication
-- Only these tables produce Postgres Changes events for the client.
-- =============================================================================
BEGIN;
  -- Create publication if it doesn't already exist
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END;
  $$;

  ALTER PUBLICATION supabase_realtime ADD TABLE
    public.rooms,
    public.room_players,
    public.games,
    public.game_players,
    public.game_calls,
    public.game_completed_lines,
    public.rematch_votes;
COMMIT;
