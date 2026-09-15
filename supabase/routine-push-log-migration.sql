-- Routine Builder — push idempotency ledger (spec §4d).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- Run once in Supabase → SQL Editor. Idempotent. A TABLE, not a user_kv key:
-- migrateLocalToCloud would overwrite a mirrored ledger and re-arm sent reminders.
create table if not exists public.routine_push_log (
  user_id     uuid        not null,
  fire_key    text        not null,
  block_id    text        not null,
  local_day   date        not null,
  fire_at_utc timestamptz not null,
  status      text        not null default 'claimed' check (status in ('claimed','sent','failed')),
  attempts    int         not null default 1 check (attempts between 1 and 2),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  primary key (user_id, fire_key)
);
create index if not exists routine_push_log_created_idx on public.routine_push_log (created_at);
alter table public.routine_push_log enable row level security;
-- No policies on purpose: only the service-role tick reads or writes this table.
