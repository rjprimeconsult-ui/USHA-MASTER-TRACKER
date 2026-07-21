-- Security hardening (2026-07) — revoke the DEFAULT public EXECUTE grant on two
-- SECURITY DEFINER functions that were never meant to be callable via the public
-- PostgREST RPC endpoint. Flagged by the Supabase database linter (0028/0029).
--
-- WHY THEY WERE EXPOSED: Postgres auto-grants EXECUTE to PUBLIC on every new
-- function unless you revoke it. The original migrations granted EXECUTE to the
-- intended role (service_role / supabase_auth_admin) but never revoked the
-- default PUBLIC grant, so `anon` + `authenticated` could call them directly via
-- /rest/v1/rpc/<fn>.
--
-- SAFE TO RUN: the real callers keep their explicit grants below —
--   * increment_blast  → called by the SERVICE-ROLE blast webhooks
--   * handle_new_user   → runs only as the AFTER INSERT trigger on auth.users
--     (as supabase_auth_admin)
-- Revoking the public grants only blocks direct RPC abuse (e.g. an anonymous
-- user forging blast counts). It does NOT touch the blast capture path or user
-- signup. This mirrors what webhook-rate-limit-migration.sql already does for
-- check_webhook_rate_limit.
--
-- NOTE — is_admin(uuid) is deliberately NOT revoked. It is referenced INSIDE RLS
-- policies (profiles / user_kv / tickets / chat_feedback), so `authenticated`
-- MUST retain EXECUTE or those policies fail and reads break. Its RPC exposure
-- is low-risk (returns a boolean) and would require a schema-move to fully fix.

BEGIN;

-- 1) increment_blast(p_user, p_date, p_platform, p_tag, p_inc)
--    Writer = service-role blast webhook only.
REVOKE EXECUTE ON FUNCTION public.increment_blast(uuid, date, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_blast(uuid, date, text, text, integer)
  TO service_role;  -- idempotent: re-assert the intended grant

-- 2) handle_new_user()
--    Runs only as the auth.users AFTER INSERT trigger (supabase_auth_admin).
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.handle_new_user()
  TO supabase_auth_admin;  -- idempotent: re-assert the intended grant

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
-- Should return NO rows granting EXECUTE to anon/authenticated for these two:
--
--   SELECT p.proname, r.rolname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('increment_blast','handle_new_user')
--     AND a.privilege_type = 'EXECUTE'
--     AND r.rolname IN ('anon','authenticated');
--
-- Then re-run Advisors → Security in the Supabase dashboard: the 0028/0029
-- warnings for increment_blast + handle_new_user should clear (is_admin will
-- still appear — that one is intentional; see NOTE above).
--
-- AFTER RUNNING: confirm blast capture still works by running the smoke test
-- (scripts/blast-burst-smoketest.mjs) against a webhook TEST token — the
-- service-role path is unaffected, so it should still record 0 non-200s.
