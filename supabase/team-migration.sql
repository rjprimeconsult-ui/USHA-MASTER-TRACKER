-- ============================================================
-- PRIM Team feature migration — org-tree edges + access audit
-- Run once in the Supabase SQL Editor. Idempotent (safe to re-run).
-- Spec: docs/superpowers/specs/2026-06-12-team-feature-design.md
-- ============================================================

-- ---------- 1) team_members: one row per direct upline → downline edge ----------
-- A "downline" may itself be a leader (an FSL is the SAT's downline AND the
-- FTAs' upline), so names are generic. downline_id is NULL until the invited
-- email resolves to a real user (invite-before-signup support).
CREATE TABLE IF NOT EXISTS team_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upline_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  downline_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  downline_email TEXT NOT NULL CHECK (downline_email = lower(downline_email)),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','active','removed','declined')),
  invited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at    TIMESTAMPTZ,
  removed_at     TIMESTAMPTZ,
  -- no duplicate invites from the same leader to the same email
  UNIQUE (upline_id, downline_email),
  -- nobody can be their own upline
  CHECK (upline_id IS DISTINCT FROM downline_id)
);

-- STRICT TREE: a person has at most ONE active direct upline.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_active_upline
  ON team_members (downline_id) WHERE status = 'active';

-- Fast downline walks (level-by-level) and pending-invite lookups at login.
CREATE INDEX IF NOT EXISTS team_members_upline_idx
  ON team_members (upline_id, status);
CREATE INDEX IF NOT EXISTS team_members_pending_email_idx
  ON team_members (downline_email) WHERE status = 'pending';

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Either side of an edge can READ it (leader sees their roster; member sees
-- who can see them). NO insert/update/delete policies exist on purpose:
-- all writes go through service-role endpoints only.
DROP POLICY IF EXISTS "team_members_upline_read" ON team_members;
CREATE POLICY "team_members_upline_read" ON team_members
  FOR SELECT USING (auth.uid() = upline_id);
DROP POLICY IF EXISTS "team_members_downline_read" ON team_members;
CREATE POLICY "team_members_downline_read" ON team_members
  FOR SELECT USING (auth.uid() = downline_id);

-- ---------- 2) team_access_log: audit of every cross-account view ----------
-- detail stores only a view/key reference (e.g. 'view_prospects') — NEVER PHI.
CREATE TABLE IF NOT EXISTS team_access_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action    TEXT NOT NULL,
  detail    TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_access_log_leader_idx
  ON team_access_log (leader_id, at DESC);
CREATE INDEX IF NOT EXISTS team_access_log_agent_idx
  ON team_access_log (agent_id, at DESC);

ALTER TABLE team_access_log ENABLE ROW LEVEL SECURITY;

-- The viewed member can see who accessed them; a leader can see their own
-- access history. Writes are service-role only (no insert policy).
DROP POLICY IF EXISTS "team_access_log_agent_read" ON team_access_log;
CREATE POLICY "team_access_log_agent_read" ON team_access_log
  FOR SELECT USING (auth.uid() = agent_id);
DROP POLICY IF EXISTS "team_access_log_leader_read" ON team_access_log;
CREATE POLICY "team_access_log_leader_read" ON team_access_log
  FOR SELECT USING (auth.uid() = leader_id);

-- ---------- 3) Role labels (added 2026-06-12) ----------
-- The upline's annotation of a direct report's org level (AGENT/FTA/FSL/SAT).
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role_label TEXT;
