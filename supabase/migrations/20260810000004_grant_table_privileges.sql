-- =============================================================================
-- Grant table/sequence/routine privileges to anon, authenticated, service_role
--
-- Supabase Cloud applies these grants automatically as part of every
-- project's own platform bootstrap, entirely outside of anything in
-- supabase/migrations/ — which is why this was never noticed against the
-- live cloud project (it already had them from day one). A `supabase start`
-- built purely from these migration files never gets them, so every table
-- created above fails with `permission denied for table X` (Postgres error
-- 42501) even for service_role, which bypasses RLS but still needs the
-- underlying GRANT like any other role. This is what a fresh local/CI
-- database was missing (first ever schema-from-scratch build this project
-- has done — bingo-testing integration suite, run against a real fresh
-- database for the first time).
--
-- anon/authenticated still answer to RLS regardless of these grants — RLS
-- remains the actual gatekeeper for those two roles. service_role bypasses
-- RLS by design (used only by Edge Functions holding the service role key),
-- so it needs full access to do its job.
--
-- Also covers privileges for tables/sequences/routines created by *future*
-- migrations via ALTER DEFAULT PRIVILEGES, so this doesn't need repeating
-- every time a new table is added.
-- =============================================================================

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
