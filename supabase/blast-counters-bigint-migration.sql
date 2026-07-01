-- Blast counters overflow-proofing — 2026-06-30 (security audit hardening)
--
-- blast_counters.contacts was INTEGER (max 2,147,483,647). increment_blast
-- does `contacts + GREATEST(EXCLUDED.contacts, 0)`, which raises SQLSTATE 22003
-- on overflow; the Ringy webhook then returns 503 so the vendor retries — for a
-- maxed-out (user, day, platform, tag) row that becomes a permanent retry loop.
-- Not realistically reachable (needs ~2.1B same-day POSTs, resets at midnight),
-- but BIGINT removes the failure mode entirely at zero cost.
--
-- Safe to run anytime; idempotent (ALTER ... TYPE is a no-op if already BIGINT).

ALTER TABLE blast_counters ALTER COLUMN contacts TYPE BIGINT;

-- Confirm:
--   SELECT data_type FROM information_schema.columns
--   WHERE table_name = 'blast_counters' AND column_name = 'contacts';
--   -- expect: bigint
