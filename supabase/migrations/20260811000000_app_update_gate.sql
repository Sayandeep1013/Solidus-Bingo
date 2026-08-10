-- =============================================================================
-- app_config — the minimum-version gate
--
-- The APK is sideloaded, not installed from a store, so Android will never
-- update anyone automatically or even tell them a new build exists. Every
-- install talks to this one backend, though, which means the backend can be
-- the lever: the app reports the version it is running, this row says the
-- oldest version still allowed, and anything older gets a blocking
-- "update required" screen instead of the app.
--
-- Deliberately seeded OFF (min_supported_version = '0.0.0', which nothing is
-- older than). Turning it on locks people out of a working app, so that has to
-- be a decision someone makes on purpose:
--
--   UPDATE public.app_config SET min_supported_version = '1.0.2';
--
-- Note what this can and cannot reach. It only governs builds that already
-- contain the client half of the check — 1.0.2 and later. Anyone on 1.0.0 or
-- 1.0.1 has no gate code in their APK and will keep playing regardless; they
-- have to be asked to reinstall by hand, once. That is the unavoidable cost of
-- not having had this from the start, and it is why the floor stays at 0.0.0
-- until there is a version worth demanding.
-- =============================================================================

CREATE TABLE public.app_config (
  -- Single-row table: the PK can only ever hold `true`, so a second INSERT
  -- collides with the primary key instead of quietly creating a rival config
  -- that half the clients would read.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- Oldest app version still allowed to run, inclusive. Compared field by
  -- numeric field (major.minor.patch), never as a string — '1.0.10' is newer
  -- than '1.0.9' but sorts before it lexically.
  min_supported_version text NOT NULL DEFAULT '0.0.0',

  -- Shown to the blocked user so they know what they are getting.
  latest_version text NOT NULL DEFAULT '1.0.2',

  -- Where the blocked user is sent. /releases/latest resolves to whatever the
  -- newest published release is, so this row does not need editing every time.
  download_url text NOT NULL
    DEFAULT 'https://github.com/Sayandeep1013/Solidus-Bingo/releases/latest',

  -- Optional line explaining why, e.g. "Scoring was corrected — older builds
  -- disagree with the server about who won." NULL falls back to generic copy.
  message text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id) VALUES (true);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Readable by anon as well as authenticated: a player whose build is too old
-- to sign in still has to be told why, and a blocked client must not need a
-- session to find that out.
CREATE POLICY "app_config_select_public"
  ON public.app_config FOR SELECT
  USING (true);

-- No client writes at all. Changing the floor is a deliberate act performed
-- with the service role (SQL editor / dashboard), not something any signed-in
-- player can do to everyone else.
