-- ============================================================================
-- user_kv — the per-user key/value store that holds ALL PRIM app data
-- (leads_v5, prospects_v1, business_*_v1, own_advances_v1, overrides_v1,
-- chargebacks_v1, investments_v2, activities_v1, push_subscriptions_v1,
-- followup_playbook_v1, agent_profile_v1, ...) as JSONB blobs per user.
--
-- WHY THIS FILE EXISTS: this table previously lived ONLY in the live Supabase
-- project with no checked-in DDL — its row-level isolation was unversioned and
-- unreproducible. This migration makes the table + its RLS the source of truth.
--
-- SAFE + IDEMPOTENT: uses CREATE/ALTER ... IF NOT EXISTS and drops+recreates
-- policies by canonical names. It will NOT touch existing rows/data. Run it in
-- Supabase → SQL Editor to ensure the live DB matches this definition.
-- ============================================================================

create table if not exists public.user_kv (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Composite PK already indexes (user_id, key); this helps any user-scoped scan.
create index if not exists user_kv_user_id_idx on public.user_kv (user_id);

-- Row-level security: a user can only see/modify their OWN rows.
alter table public.user_kv enable row level security;

drop policy if exists user_kv_select_own on public.user_kv;
create policy user_kv_select_own on public.user_kv
  for select using (auth.uid() = user_id);

drop policy if exists user_kv_insert_own on public.user_kv;
create policy user_kv_insert_own on public.user_kv
  for insert with check (auth.uid() = user_id);

drop policy if exists user_kv_update_own on public.user_kv;
create policy user_kv_update_own on public.user_kv
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_kv_delete_own on public.user_kv;
create policy user_kv_delete_own on public.user_kv
  for delete using (auth.uid() = user_id);

-- NOTE: the admin "read all" policy (for the read-only /admin dashboard) lives
-- in admin-migration.sql and is gated on profiles.is_admin = true. Keep both.

-- ----------------------------------------------------------------------------
-- VERIFY after running (expect rowsecurity = true, and only self/admin policies):
--   select relname, relrowsecurity from pg_class where relname = 'user_kv';
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'user_kv';
-- ----------------------------------------------------------------------------
