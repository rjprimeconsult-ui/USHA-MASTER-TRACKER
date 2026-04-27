-- =====================================================================
-- PRIM — Performance, Revenue & Investment Manager
-- Database schema for cloud-synced agent tracker
-- =====================================================================
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
-- It's idempotent — safe to re-run if you tweak something.
-- =====================================================================

-- ---------- Profiles (one per user) ----------
-- Mirrors auth.users with our agent-specific settings (tier, budgets, etc.)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  tier TEXT DEFAULT 'WA',
  platform_budget NUMERIC DEFAULT 4000,
  business_accounts JSONB DEFAULT '[]'::jsonb,
  advance_months_history JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- Per-entity tables ----------
-- Each row stores its entity as a JSON blob. Keeps the schema flexible
-- while we iterate; we can normalize later if we add server-side queries.

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS leads_user_idx ON leads (user_id);

CREATE TABLE IF NOT EXISTS investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS investments_user_idx ON investments (user_id);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activities_user_idx ON activities (user_id);

CREATE TABLE IF NOT EXISTS chargebacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chargebacks_user_idx ON chargebacks (user_id);

CREATE TABLE IF NOT EXISTS overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS overrides_user_idx ON overrides (user_id);

CREATE TABLE IF NOT EXISTS platform_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_expenses_user_idx ON platform_expenses (user_id);

CREATE TABLE IF NOT EXISTS business_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_expenses_user_idx ON business_expenses (user_id);

CREATE TABLE IF NOT EXISTS business_income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_income_user_idx ON business_income (user_id);

-- ---------- Row Level Security ----------
-- Enforces that each user can only see/touch rows where user_id = their auth.uid().
-- This is what makes the publishable key safe to ship in client code.

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chargebacks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE overrides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_expenses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_expenses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_income     ENABLE ROW LEVEL SECURITY;

-- Profile policies
DROP POLICY IF EXISTS "profiles_self_read"   ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
DROP POLICY IF EXISTS "profiles_self_insert" ON profiles;
CREATE POLICY "profiles_self_read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_self_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Generic per-table policies (helper macro pattern, repeated for each)
-- leads
DROP POLICY IF EXISTS "leads_select" ON leads;
DROP POLICY IF EXISTS "leads_insert" ON leads;
DROP POLICY IF EXISTS "leads_update" ON leads;
DROP POLICY IF EXISTS "leads_delete" ON leads;
CREATE POLICY "leads_select" ON leads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "leads_insert" ON leads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (auth.uid() = user_id);

-- investments
DROP POLICY IF EXISTS "investments_select" ON investments;
DROP POLICY IF EXISTS "investments_insert" ON investments;
DROP POLICY IF EXISTS "investments_update" ON investments;
DROP POLICY IF EXISTS "investments_delete" ON investments;
CREATE POLICY "investments_select" ON investments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "investments_insert" ON investments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "investments_update" ON investments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "investments_delete" ON investments FOR DELETE USING (auth.uid() = user_id);

-- activities
DROP POLICY IF EXISTS "activities_select" ON activities;
DROP POLICY IF EXISTS "activities_insert" ON activities;
DROP POLICY IF EXISTS "activities_update" ON activities;
DROP POLICY IF EXISTS "activities_delete" ON activities;
CREATE POLICY "activities_select" ON activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "activities_insert" ON activities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "activities_update" ON activities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "activities_delete" ON activities FOR DELETE USING (auth.uid() = user_id);

-- chargebacks
DROP POLICY IF EXISTS "chargebacks_select" ON chargebacks;
DROP POLICY IF EXISTS "chargebacks_insert" ON chargebacks;
DROP POLICY IF EXISTS "chargebacks_update" ON chargebacks;
DROP POLICY IF EXISTS "chargebacks_delete" ON chargebacks;
CREATE POLICY "chargebacks_select" ON chargebacks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chargebacks_insert" ON chargebacks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chargebacks_update" ON chargebacks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "chargebacks_delete" ON chargebacks FOR DELETE USING (auth.uid() = user_id);

-- overrides
DROP POLICY IF EXISTS "overrides_select" ON overrides;
DROP POLICY IF EXISTS "overrides_insert" ON overrides;
DROP POLICY IF EXISTS "overrides_update" ON overrides;
DROP POLICY IF EXISTS "overrides_delete" ON overrides;
CREATE POLICY "overrides_select" ON overrides FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "overrides_insert" ON overrides FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "overrides_update" ON overrides FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "overrides_delete" ON overrides FOR DELETE USING (auth.uid() = user_id);

-- platform_expenses
DROP POLICY IF EXISTS "platform_expenses_select" ON platform_expenses;
DROP POLICY IF EXISTS "platform_expenses_insert" ON platform_expenses;
DROP POLICY IF EXISTS "platform_expenses_update" ON platform_expenses;
DROP POLICY IF EXISTS "platform_expenses_delete" ON platform_expenses;
CREATE POLICY "platform_expenses_select" ON platform_expenses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "platform_expenses_insert" ON platform_expenses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "platform_expenses_update" ON platform_expenses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "platform_expenses_delete" ON platform_expenses FOR DELETE USING (auth.uid() = user_id);

-- business_expenses
DROP POLICY IF EXISTS "business_expenses_select" ON business_expenses;
DROP POLICY IF EXISTS "business_expenses_insert" ON business_expenses;
DROP POLICY IF EXISTS "business_expenses_update" ON business_expenses;
DROP POLICY IF EXISTS "business_expenses_delete" ON business_expenses;
CREATE POLICY "business_expenses_select" ON business_expenses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "business_expenses_insert" ON business_expenses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "business_expenses_update" ON business_expenses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "business_expenses_delete" ON business_expenses FOR DELETE USING (auth.uid() = user_id);

-- business_income
DROP POLICY IF EXISTS "business_income_select" ON business_income;
DROP POLICY IF EXISTS "business_income_insert" ON business_income;
DROP POLICY IF EXISTS "business_income_update" ON business_income;
DROP POLICY IF EXISTS "business_income_delete" ON business_income;
CREATE POLICY "business_income_select" ON business_income FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "business_income_insert" ON business_income FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "business_income_update" ON business_income FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "business_income_delete" ON business_income FOR DELETE USING (auth.uid() = user_id);

-- ---------- Auto-create profile on user sign-up ----------
-- Whenever auth.users gets a new row (someone signs up), make a matching
-- profiles row so the app has a place to store their settings.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block sign-up — profile can be created lazily later.
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- Storage bucket for receipt attachments ----------
-- Receipt photos / PDFs live in Supabase Storage, not Postgres.
-- Bucket created here; RLS policies restrict access to the file owner.

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_owner_read"   ON storage.objects;
DROP POLICY IF EXISTS "receipts_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "receipts_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_owner_delete" ON storage.objects;

-- Path convention: receipts/<user_id>/<filename>
CREATE POLICY "receipts_owner_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "receipts_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "receipts_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "receipts_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Done. Verify by running:
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- You should see: profiles, leads, investments, activities,
-- chargebacks, overrides, platform_expenses, business_expenses, business_income
-- =====================================================================
