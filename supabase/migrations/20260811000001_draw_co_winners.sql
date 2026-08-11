-- =============================================================================
-- Shared victories: the DRAW outcome and co-winners
--
-- Spec: bingo-game-mechanics §5 (see the E1–E12 edge-case table).
--
-- A called number is cut on every board at once, so one call routinely
-- completes the fifth line for more than one player at the same instant. There
-- is no ordering between those completions to break the tie with, so the game
-- now records them as what they are — a shared victory — instead of handing it
-- to whichever of them the code happened to look at first.
--
-- DRAW is deliberately NOT the same outcome as ABANDONED:
--
--   DRAW       several players reached 5 on the same call. They are
--              co-winners; everyone else lost. games.winner_id is NULL,
--              because nobody won it alone.
--   ABANDONED  all 25 numbers were called and nobody reached 5. Nobody
--              achieved anything, and there are no co-winners.
--
-- Collapsing them would make the result screen lie in one direction or the
-- other, and would make ranked stats unable to tell a shared win from a
-- goalless finish.
-- =============================================================================

-- Order matters: widen the CHECK before anything can write the new value.
ALTER TABLE public.game_results
  DROP CONSTRAINT game_results_outcome_valid;

ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_outcome_valid
  CHECK (outcome IN ('WINNER', 'DRAW', 'CANCELLED', 'ABANDONED'));

-- Empty for every other outcome, which is why it is NOT NULL with a default
-- rather than nullable — "no co-winners" is a fact, not an unknown.
ALTER TABLE public.game_results
  ADD COLUMN co_winner_ids uuid[] NOT NULL DEFAULT '{}';

-- A draw with one co-winner is a WINNER that was mislabelled, and a draw with
-- none is an ABANDONED that was mislabelled. Neither should ever reach the
-- table, so the database refuses them outright rather than leaving the result
-- screen to guess what a one-person draw means.
ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_draw_needs_co_winners
  CHECK (outcome <> 'DRAW' OR array_length(co_winner_ids, 1) >= 2);

-- Conversely, co-winners only make sense on a draw.
ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_co_winners_only_on_draw
  CHECK (outcome = 'DRAW' OR co_winner_ids = '{}');

COMMENT ON COLUMN public.game_results.co_winner_ids IS
  'Players who reached 5 lines on the same deciding call, ordered by turn_order '
  'so a replay of that call records an identical array. Non-empty only when '
  'outcome = DRAW; games.winner_id is NULL in that case.';
