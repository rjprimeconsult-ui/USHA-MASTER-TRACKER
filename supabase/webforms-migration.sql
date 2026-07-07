-- Website Leads (universal form webhook) — adds the per-agent webhook token.
-- Run in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS everywhere).
-- The token is read/written ONLY by service-role API routes (webforms config +
-- webhook); no RLS change is needed because profiles' existing policies do not
-- grant clients access to this column path (same posture as ringy_webhook_token).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS webforms_webhook_token text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_webforms_webhook_token_key
  ON profiles (webforms_webhook_token)
  WHERE webforms_webhook_token IS NOT NULL;
