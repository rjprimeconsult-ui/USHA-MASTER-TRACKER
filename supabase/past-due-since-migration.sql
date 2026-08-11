-- Subscription enforcement: past_due_since lifecycle column.
-- HARD PRECONDITION for all live testing AND prod deploy (plan Task 2 / spec S9).
-- If skipped: (READ) requireFullAccess's SELECT errors -> fail-closed 402 for
-- every account including complimentary; (WRITE) every subscription writer's
-- .update() carries past_due_since -> column-does-not-exist -> webhook 500s,
-- Stripe retries then drops events, subscription state stops syncing.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

-- Backfill (REQUIRED, spec S9.2 / N-9): agents already past_due at deploy get a
-- fresh 3-day grace from deploy rather than instant lockout.
UPDATE profiles
SET past_due_since = now()
WHERE subscription_status = 'past_due'
  AND past_due_since IS NULL;
