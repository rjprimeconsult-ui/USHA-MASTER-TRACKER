-- ============================================================
-- PRIM Blast counters — EDIT support (run once, after blast-counters-migration.sql)
-- Idempotent (safe to re-run).
-- Lets an agent correct an auto-captured Ringy blast row from the Blasts tab:
--   * notes  — a free-text column the counter didn't have before
--   * UPDATE RLS policy — so the agent's authed client can fix its OWN rows
--     (count / campaign-tag / notes). Writes are still owner-scoped.
-- ============================================================

ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS notes TEXT;

DROP POLICY IF EXISTS "blast_counters_update_own" ON blast_counters;
CREATE POLICY "blast_counters_update_own" ON blast_counters
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
