-- =====================================================================
-- PRIM complimentary access flag
-- Adds an is_complimentary boolean to profiles + flips it on for the
-- four hand-picked test users so they bypass the paywall without
-- needing a Stripe subscription.
-- =====================================================================
-- To convert a user from complimentary to paying:
--   UPDATE profiles SET is_complimentary = false WHERE email = 'X';
-- They'll hit the paywall on next sign-in and can subscribe normally.
-- =====================================================================

-- 1. Add the column (idempotent)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS profiles_is_complimentary_idx ON profiles (is_complimentary)
  WHERE is_complimentary = true;

-- 2. Grant complimentary access to the named test users
UPDATE profiles
SET is_complimentary = true
WHERE email IN (
  'michael.tolentino@healthservicespro.com',
  'harrisonhealthadvisory@gmail.com',
  'moralehealth@gmail.com',
  'rjprimeconsult@gmail.com'
);

-- 3. Sanity check — should return 4 rows (or fewer if some haven't signed up yet)
SELECT email, is_complimentary, subscription_status
FROM profiles
WHERE is_complimentary = true;
