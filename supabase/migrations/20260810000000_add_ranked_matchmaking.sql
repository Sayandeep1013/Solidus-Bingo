-- =============================================================================
-- Ranked Matchmaking — schema additions
-- Spec: .kiro/specs/bingo-ranked-matchmaking/requirements.md
-- =============================================================================

-- ── rooms: is_ranked flag + nullable code (matchmade rooms have no shareable code) ──
ALTER TABLE public.rooms ADD COLUMN is_ranked boolean NOT NULL DEFAULT false;

ALTER TABLE public.rooms ALTER COLUMN code DROP NOT NULL;

ALTER TABLE public.rooms DROP CONSTRAINT rooms_code_format;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_code_format
  CHECK (
    (is_ranked AND code IS NULL)
    OR (NOT is_ranked AND code ~ '^[A-HJ-NP-TV-Z2-9]{6}$')
  );

-- The existing partial unique index already only covers non-NULL codes among
-- non-CLOSED rooms implicitly (a NULL code never satisfies the uniqueness
-- comparison), so ranked rooms with NULL code need no index change.

-- ── matchmaking_queue ────────────────────────────────────────────────────────
CREATE TABLE public.matchmaking_queue (
  id                uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capacity          smallint    NOT NULL,
  status            text        NOT NULL DEFAULT 'WAITING',
  matched_room_id   uuid        NULL REFERENCES public.rooms(id) ON DELETE SET NULL,
  queued_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT matchmaking_queue_capacity_valid
    CHECK (capacity IN (2, 3, 4)),

  CONSTRAINT matchmaking_queue_status_valid
    CHECK (status IN ('WAITING', 'MATCHED', 'CANCELLED'))
);

-- At most one ACTIVE (WAITING) queue entry per player (spec Req 1.7)
CREATE UNIQUE INDEX matchmaking_queue_player_waiting_unique
  ON public.matchmaking_queue(player_id)
  WHERE status = 'WAITING';

-- Performance index for the matching scan (oldest-first per capacity)
CREATE INDEX matchmaking_queue_capacity_waiting_idx
  ON public.matchmaking_queue(capacity, queued_at)
  WHERE status = 'WAITING';

-- RLS
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- A player can see only their own queue entries
CREATE POLICY "matchmaking_queue_select_own"
  ON public.matchmaking_queue FOR SELECT
  USING (player_id = (select auth.uid()));

-- No direct INSERT/UPDATE/DELETE from client — join-queue/leave-queue Edge
-- Functions use the service role.

-- Realtime — client subscribes to its own queue row to detect MATCHED
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;
