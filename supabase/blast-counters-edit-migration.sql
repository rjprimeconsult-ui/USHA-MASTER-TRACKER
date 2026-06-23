-- ============================================================
-- PRIM Blast counters — EDIT support (run once, after blast-counters-migration.sql)
-- Idempotent (safe to re-run).
-- Lets an agent correct an auto-captured Ringy blast row from the Blasts tab:
--   * notes / range_start / range_end — free-text columns the counter didn't
--     have before (the per-lead webhook can't know the blasted lead-date range,
--     so agents log it manually on edit)
--   * UPDATE RLS policy — so the agent's authed client can fix its OWN rows
--     (count / campaign-tag / lead range / notes). Writes are still owner-scoped.
-- ============================================================

ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS range_start TEXT;
ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS range_end TEXT;

DROP POLICY IF EXISTS "blast_counters_update_own" ON blast_counters;
CREATE POLICY "blast_counters_update_own" ON blast_counters
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
