-- Routine Builder — appointment rows for the minute tick (spec §6b.1).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- Returns ONLY (user_id, id, stage, appointment_time, archived_at) for elements
-- of each user's prospects_v1 whose appointmentTime starts with one of the UTC
-- day prefixes and whose stage is in that user's appointmentStages. The blob
-- itself is never transferred. Frozen/attached items need no prospect row.
-- Legacy string-typed blobs are cast; a per-user failure is a WARNING, not an abort.
create or replace function public.routine_appt_rows(p_user_ids uuid[], p_prefixes text[])
returns table (user_id uuid, id text, stage text, appointment_time text, archived_at text)
language plpgsql
security definer
set search_path = public
as $$
declare
  u          uuid;
  v_blob     jsonb;
  v_settings jsonb;
  v_stages   text[];
begin
  if p_user_ids is null then return; end if;
  foreach u in array p_user_ids loop
    begin
      select value into v_settings from public.user_kv
        where user_kv.user_id = u and user_kv.key = 'routine_settings_v1';
      if v_settings is not null and jsonb_typeof(v_settings) = 'string' then
        v_settings := (v_settings #>> '{}')::jsonb;
      end if;
      v_stages := array(
        select jsonb_array_elements_text(
          coalesce(v_settings -> 'appointmentStages', '["WEBBY_SET","WEBBY_CONFIRMED","APPOINTMENT_SET"]'::jsonb)));
      if coalesce(array_length(v_stages, 1), 0) = 0 then continue; end if;

      select value into v_blob from public.user_kv
        where user_kv.user_id = u and user_kv.key = 'prospects_v1';
      if v_blob is null then continue; end if;
      if jsonb_typeof(v_blob) = 'string' then v_blob := (v_blob #>> '{}')::jsonb; end if;
      if jsonb_typeof(v_blob) <> 'array' then continue; end if;

      return query
        select u, e ->> 'id', e ->> 'stage', e ->> 'appointmentTime', e ->> 'archivedAt'
        from jsonb_array_elements(v_blob) e
        where left(coalesce(e ->> 'appointmentTime', ''), 10) = any(p_prefixes)
          and (e ->> 'stage') = any(v_stages)
          and (e ->> 'archivedAt') is null;
    exception when others then
      raise warning 'routine_appt_rows: user % skipped: %', u, sqlerrm;
    end;
  end loop;
  return;
end;
$$;

revoke execute on function public.routine_appt_rows(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.routine_appt_rows(uuid[], text[]) to service_role;
