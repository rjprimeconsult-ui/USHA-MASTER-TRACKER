-- Webhook rate limiter — 2026-06-30 (security audit hardening)
--
-- A generous, fail-open per-token rate limit for the inbound token webhooks
-- (Ringy / Benepath / blast). The token is the only credential and travels in
-- a URL, so a leaked token could be used to flood fake leads / inflate a blast
-- counter. This caps a runaway flood WITHOUT throttling a real blast: the
-- default ceiling wired in the routes is 10,000 requests/token/minute, far
-- above any legitimate burst.
--
-- Design: ONE row per token (bounded table size = number of agents), fixed
-- window that resets when it expires. SECURITY DEFINER + granted only to
-- service_role, so only the webhook route handlers (service-role key) can call
-- it — never the anon/authenticated client.
--
-- SAFE ORDERING: the route code fails OPEN if this function doesn't exist yet
-- (the RPC error is ignored and the request proceeds), so deploying the code
-- before running this migration cannot break webhook capture. Run this to
-- ACTIVATE the limit.

CREATE TABLE IF NOT EXISTS webhook_rate_limits (
  token        text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: with RLS enabled and no policy, the anon/authenticated
-- roles get zero access; only the service-role key (used by the webhook routes)
-- can read/write it.

CREATE OR REPLACE FUNCTION check_webhook_rate_limit(p_token text, p_limit int, p_window_secs int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO webhook_rate_limits (token, count, window_start)
    VALUES (p_token, 1, now())
    ON CONFLICT (token) DO UPDATE SET
      count = CASE
                WHEN webhook_rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                THEN 1
                ELSE webhook_rate_limits.count + 1
              END,
      window_start = CASE
                WHEN webhook_rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                THEN now()
                ELSE webhook_rate_limits.window_start
              END
    RETURNING count INTO v_count;
  RETURN v_count <= p_limit;   -- true = allowed, false = over the limit
END;
$$;

REVOKE EXECUTE ON FUNCTION check_webhook_rate_limit(text, int, int) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_webhook_rate_limit(text, int, int) TO service_role;
