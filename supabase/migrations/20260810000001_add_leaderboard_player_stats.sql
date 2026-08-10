-- =============================================================================
-- Leaderboard — player_stats aggregate table
-- Spec: .kiro/specs/bingo-leaderboard/requirements.md
--
-- Written to ONLY by the internal game-finalization logic inside the
-- call-number Edge Function, and ONLY when the finishing game's room has
-- is_ranked = true. Never client-writable — this is what makes normal-room
-- play structurally incapable of affecting the leaderboard.
-- =============================================================================

CREATE TABLE public.player_stats (
  player_id     uuid        NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  games_played  smallint    NOT NULL DEFAULT 0,
  games_won     smallint    NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT player_stats_games_played_non_negative
    CHECK (games_played >= 0),

  CONSTRAINT player_stats_games_won_non_negative
    CHECK (games_won >= 0),

  CONSTRAINT player_stats_won_le_played
    CHECK (games_won <= games_played)
);

CREATE TRIGGER player_stats_set_updated_at
  BEFORE UPDATE ON public.player_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Performance indexes for the two leaderboard sort modes
CREATE INDEX player_stats_games_won_idx ON public.player_stats(games_won DESC);
CREATE INDEX player_stats_games_played_idx ON public.player_stats(games_played);

-- RLS — public read (leaderboard is inherently public: usernames + win/loss
-- counts, nothing sensitive). No client write policies at all — service
-- role only, from inside the game-finalization transaction.
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_stats_select_public"
  ON public.player_stats FOR SELECT
  USING (true);
