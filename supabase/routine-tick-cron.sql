-- Routine Builder — minute trigger (spec §6a). Requires extensions pg_cron + pg_net
-- and Vault secret `prim_cron_secret` (= Vercel CRON_SECRET). Raises if the secret
-- is missing — by design. Re-run after `select cron.unschedule('prim-routine-tick');`.
do $$ begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'prim_cron_secret')
  then raise exception 'prim_cron_secret missing from Vault'; end if; end $$;
select cron.schedule('prim-routine-tick', '* * * * *', $$
  do $x$ declare s text; begin
    select decrypted_secret into s from vault.decrypted_secrets where name = 'prim_cron_secret';
    if s is null then raise exception 'prim_cron_secret missing from Vault'; end if;
    perform net.http_get(url := 'https://app.primtracker.com/api/routine/tick',
      headers := jsonb_build_object('Authorization', 'Bearer ' || s),
      timeout_milliseconds := 30000);
  end $x$; $$);
