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
create or replace function public.routine_day_write(p_user uuid, p_records jsonb)
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

  -- Pass 1: keep every stored element, replacing where the CAS matches.
  for el in select * from jsonb_array_elements(v_stored) loop
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

revoke execute on function public.routine_day_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.routine_day_write(uuid, jsonb) to service_role;
