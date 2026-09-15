-- Routine Builder — atomic per-record write into routine_day_v1 (spec §4b, §6b.4).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- The tick NEVER rewrites the user_kv row. For each incoming record:
--   * append if no element with that id exists in the stored array or earlier in this batch;
--   * replace iff rec.expect is non-null and equals the stored element's updatedAt
--     (expected-version CAS — a client write that landed after the tick's read
--     changes updatedAt and the replace is rejected);
--   * otherwise skip.
-- `expect` is stripped before storing. Returns the ids written. The row is
-- created empty and locked BEFORE it is read so an agent's first-ever record is
-- serialised against a concurrent client save.
--
-- p_floor ('YYYY-MM-DD', the tick passes addDays(today, -7)) enforces §4b's 7-day retention
-- on the SERVER as well: Pass 1 drops every stored element older than it instead of copying
-- it forward. Without it only the client's write path ever prunes, so an agent who sets a
-- routine up once and then works out of another tab accumulates an `appt` record per started
-- appointment plus the day's `owed` record every day, forever — and the tick re-reads that
-- whole jsonb every minute and Pass 1 rebuilds it element by element, so the cost is
-- quadratic in bytes and unbounded. The row is already locked by the `for update` below, so
-- the prune costs no extra round trip and cannot race a client save. Null prunes nothing.
--
-- RUN THIS FILE WHOLE, and note the DROP: `create or replace` cannot change a signature, and
-- p_floor makes this routine_day_write(uuid, jsonb, text) where the first release was
-- (uuid, jsonb). Dropping also drops that function's grants, which is why the revoke/grant
-- at the foot of the file are part of the same run. p_floor defaults to null so a still-
-- deployed older caller keeps working (without the prune) until the new route ships.
drop function if exists public.routine_day_write(uuid, jsonb);

create or replace function public.routine_day_write(p_user uuid, p_records jsonb, p_floor text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored  jsonb;
  v_new     jsonb := '[]'::jsonb;
  el        jsonb;
  rec       jsonb;
  v_written text[] := '{}';
  v_id      text;
  v_expect  text;
  v_replaced boolean;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then return v_written; end if;

  insert into public.user_kv (user_id, key, value)
    values (p_user, 'routine_day_v1', '[]'::jsonb)
    on conflict (user_id, key) do nothing;

  select value into v_stored from public.user_kv
    where user_kv.user_id = p_user and user_kv.key = 'routine_day_v1'
    for update;

  if v_stored is not null and jsonb_typeof(v_stored) = 'string' then
    begin
      v_stored := (v_stored #>> '{}')::jsonb;
    exception when others then
      v_stored := '[]'::jsonb;
    end;
  end if;
  if v_stored is null or jsonb_typeof(v_stored) <> 'array' then v_stored := '[]'::jsonb; end if;

  -- Pass 1: keep every stored element, replacing where the CAS matches — except the ones
  -- the retention floor has passed, which are dropped here instead of copied into v_new.
  -- An incoming record sharing a pruned id is still appended by Pass 2 (it is not in v_new),
  -- so a live record is never lost to the prune.
  for el in select * from jsonb_array_elements(v_stored) loop
    if p_floor is not null and (el ->> 'day') is not null and (el ->> 'day') < p_floor then
      continue;
    end if;
    v_replaced := false;
    for rec in select * from jsonb_array_elements(p_records) loop
      if (rec ->> 'id') is not null and (rec ->> 'id') = (el ->> 'id') then
        v_expect := rec ->> 'expect';
        if v_expect is not null and v_expect = (el ->> 'updatedAt') then
          v_new := v_new || jsonb_build_array(rec - 'expect');
          v_written := array_append(v_written, rec ->> 'id');
          v_replaced := true;
        end if;
        exit;
      end if;
    end loop;
    if not v_replaced then v_new := v_new || jsonb_build_array(el); end if;
  end loop;

  -- Pass 2: append incoming records whose id is absent from the stored array.
  for rec in select * from jsonb_array_elements(p_records) loop
    v_id := rec ->> 'id';
    if v_id is null then continue; end if;
    if not exists (select 1 from jsonb_array_elements(v_new) s where (s ->> 'id') = v_id) then
      v_new := v_new || jsonb_build_array(rec - 'expect');
      v_written := array_append(v_written, v_id);
    end if;
  end loop;

  update public.user_kv set value = v_new, updated_at = now()
    where user_kv.user_id = p_user and user_kv.key = 'routine_day_v1';
  return v_written;
end;
$$;

revoke execute on function public.routine_day_write(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.routine_day_write(uuid, jsonb, text) to service_role;
