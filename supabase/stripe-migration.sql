-- =====================================================================
-- PRIM Stripe subscription columns
-- Run once in Supabase SQL Editor.
-- =====================================================================
-- Adds Stripe-related state to the profiles table so we can track:
--   - Which Stripe customer this user is (one-to-one with profiles.id)
--   - Current subscription status (trialing / active / past_due / canceled)
--   - Tier they're on (starter / pro / team)
--   - Billing period (monthly / yearly)
--   - When the trial ends + when the current paid period ends
--   - Whether they've scheduled cancellation at period end
-- =====================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx ON profiles (stripe_customer_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT;
-- Possible values mirror Stripe's subscription.status:
-- 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired'
-- NULL = no subscription ever started

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier TEXT;
-- 'starter' | 'pro' | 'team' — derived from the Price ID on the active subscription

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_period TEXT;
-- 'monthly' | 'yearly'

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;
