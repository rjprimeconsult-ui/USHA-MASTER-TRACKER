-- ============================================================
-- PRIM Agent Support Tickets migration — 2026-07-01
-- Run once in the Supabase SQL Editor. Idempotent where practical.
-- Spec: docs/superpowers/specs/2026-07-01-agent-support-tickets-design.md
--
-- Security model (mirrors the 2026-06-30 hardening + blast_counters):
--   * Agents may INSERT + SELECT only their OWN tickets.
--   * Admin may SELECT all (via public.is_admin).
--   * There is NO client UPDATE/DELETE policy — every status/notes/resolution
--     write goes through the service-role admin route. This removes the entire
--     class of the 2026-06-30 self-escalation bug (no column-unrestricted UPDATE).
-- ============================================================

-- ---------- 1) tickets table ----------
CREATE TABLE IF NOT EXISTS tickets (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- ticket #
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- submitter
  email           TEXT NOT NULL,                                     -- submitter email (for resolution email)
  name            TEXT,
  category        TEXT NOT NULL CHECK (category IN
                    ('Upload','Import','Login','Data looks wrong','Billing','Other','Custom')),
  custom_category TEXT,                                              -- required when category='Custom' (validated in route)
  description     TEXT NOT NULL,                                     -- POTENTIALLY-PHI → contained (never emailed/logged)
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,                -- { page, lastError, appVersion, userAgent, ts }
  screenshot_path TEXT,                                             -- object path in bucket 'ticket-screenshots' (optional)
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved')),
  admin_notes     TEXT,                                             -- internal (Juan/Claude)
  resolution      TEXT,                                             -- PHI-safe; goes in the agent's resolution email
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tickets_status_created_idx ON tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_user_idx ON tickets (user_id);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Agent may create only their own ticket:
DROP POLICY IF EXISTS "tickets_self_insert" ON tickets;
CREATE POLICY "tickets_self_insert" ON tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Agent may read only their own:
DROP POLICY IF EXISTS "tickets_self_read" ON tickets;
CREATE POLICY "tickets_self_read" ON tickets FOR SELECT
  USING (auth.uid() = user_id);

-- Admin may read all (the admin dashboard reads client-side via this policy,
-- exactly like user_kv_admin_read):
DROP POLICY IF EXISTS "tickets_admin_read" ON tickets;
CREATE POLICY "tickets_admin_read" ON tickets FOR SELECT
  USING (public.is_admin(auth.uid()));

-- NO client UPDATE/DELETE policy — writes are service-role only.

-- ---------- 2) screenshot storage bucket ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-screenshots', 'ticket-screenshots', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ticket_shots_owner_read"   ON storage.objects;
DROP POLICY IF EXISTS "ticket_shots_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "ticket_shots_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "ticket_shots_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "ticket_shots_admin_read"   ON storage.objects;

-- Path convention: ticket-screenshots/<user_id>/<ticket-id>.<ext>
-- (Owner policies are defense-in-depth; the route uploads via the service-role
--  client, which bypasses RLS. The admin-read policy is what lets the admin
--  BROWSER display another agent's screenshot in the queue.)
CREATE POLICY "ticket_shots_owner_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ticket_shots_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ticket_shots_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ticket_shots_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ticket_shots_admin_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'ticket-screenshots' AND public.is_admin(auth.uid()));

-- ---------- Verify ----------
--   SELECT policyname FROM pg_policies WHERE tablename = 'tickets';
--     -- expect tickets_self_insert, tickets_self_read, tickets_admin_read (no update/delete)
--   SELECT id FROM storage.buckets WHERE id = 'ticket-screenshots';
