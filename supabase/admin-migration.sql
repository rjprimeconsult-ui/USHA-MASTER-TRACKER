-- =====================================================================
-- PRIM admin role migration
-- Run once in your Supabase SQL Editor.
-- =====================================================================
-- Adds an `is_admin` flag on profiles. Admin users can read (but not edit)
-- every other user's profile + cloud-synced data via the /admin page.
-- =====================================================================

-- 1. Add is_admin column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 2. Helper function: returns true when the calling user has is_admin=true.
--    Marked STABLE so Postgres can cache the result within a query for
--    speed; SECURITY DEFINER so it can read profiles without infinite RLS
--    recursion when the caller is non-admin.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = uid),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- 3. Add admin SELECT policies (alongside existing self-only policies).
--    RLS combines multiple SELECT policies with OR — so users can read their
--    own data AND admins can read everyone's.

DROP POLICY IF EXISTS "profiles_admin_read" ON profiles;
CREATE POLICY "profiles_admin_read" ON profiles FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "user_kv_admin_read" ON user_kv;
CREATE POLICY "user_kv_admin_read" ON user_kv FOR SELECT
  USING (public.is_admin(auth.uid()));

-- 4. Promote juantrejo9082@gmail.com to admin
UPDATE profiles
SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'juantrejo9082@gmail.com');

-- Verification — should return one row with is_admin = true
SELECT u.email, p.is_admin, p.created_at
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.is_admin = true;
