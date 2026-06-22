-- ============================================================
-- PRIM Blast counters migration — atomic per-(user,day,platform,tag) counter
-- Run once in the Supabase SQL Editor. Idempotent (safe to re-run).
-- Spec: docs/superpowers/specs/2026-06-22-blast-log-design.md (native-capture addendum)
--
-- Why a counter table instead of the blast_log_v1 JSON array:
-- a Ringy repurpose tag fires ONE webhook per lead, so a 2,000-lead blast is a
-- 2,000-POST burst. Read-modify-write of one JSON row makes ~94% of those lose
-- the compare-and-swap race and silently drop (observed: 2,000 fired → 119
-- logged). An atomic INSERT ... ON CONFLICT DO UPDATE increment serializes at
-- the row level with zero lost updates.
-- ============================================================

-- ---------- 1) blast_counters: one row per user/day/platform/tag ----------
CREATE TABLE IF NOT EXISTS blast_counters (
  user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_date  DATE        NOT NULL,
  platform  TEXT        NOT NULL,
  tag       TEXT        NOT NULL DEFAULT '',
  contacts  INTEGER     NOT NULL DEFAULT 0,
  first_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, run_date, platform, tag)
);

ALTER TABLE blast_counters ENABLE ROW LEVEL SECURITY;

-- Owner can read + delete their own counters. NO insert/update policy on
-- purpose: the only writer is the service-role webhook via increment_blast().
DROP POLICY IF EXISTS "blast_counters_select_own" ON blast_counters;
CREATE POLICY "blast_counters_select_own" ON blast_counters
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "blast_counters_delete_own" ON blast_counters;
CREATE POLICY "blast_counters_delete_own" ON blast_counters
  FOR DELETE USING (auth.uid() = user_id);

-- ---------- 2) increment_blast: atomic, lossless increment ----------
-- One statement; Postgres row-level locking serializes the burst with no lost
-- updates. Called only by the service-role webhook (which bypasses RLS).
CREATE OR REPLACE FUNCTION increment_blast(
  p_user UUID, p_date DATE, p_platform TEXT, p_tag TEXT, p_inc INTEGER
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO blast_counters (user_id, run_date, platform, tag, contacts, last_at)
  VALUES (p_user, p_date, p_platform, p_tag, GREATEST(p_inc, 0), NOW())
  ON CONFLICT (user_id, run_date, platform, tag)
  DO UPDATE SET contacts = blast_counters.contacts + GREATEST(EXCLUDED.contacts, 0),
                last_at  = NOW();
$$;

GRANT EXECUTE ON FUNCTION increment_blast(UUID, DATE, TEXT, TEXT, INTEGER) TO service_role;
