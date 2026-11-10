-- =========================================================
-- MOCHI - invio dei promemoria e pulizia notturna
-- Prima abilita le estensioni: Database > Extensions > pg_cron e pg_net (il Vault è già attivo).
-- Poi sostituisci i valori tra < > e lancia questo script nel SQL Editor, una volta sola.
-- =========================================================

-- 1) Il segreto va nel Vault di Supabase, cifrato.
--    Stesso valore impostato come CRON_SECRET nella funzione (almeno 24 caratteri casuali).
select vault.create_secret('<STESSO-CRON_SECRET-IMPOSTATO-NELLA-FUNZIONE>', 'mochi_cron_secret');

-- 2) Ogni minuto controlla se c'è qualcosa da mandare; chiama la funzione solo in quel caso
select cron.schedule(
  'mochi-promemoria',
  '* * * * *',
  $$
  do $m$ begin if public.ci_sono_invii() then
    perform net.http_post(
      url     := 'https://<ID-PROGETTO>.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'apikey',        '<PUBLISHABLE-KEY>',   -- sb_publishable_..., non è segreta
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mochi_cron_secret')
      ),
      body    := '{}'::jsonb
    );
  end if; end $m$;
  $$
);

-- 3) Ogni notte alle 3:17: registri del cron, inviti scaduti, tentativi e notifiche vecchie
select cron.schedule('mochi-pulizia', '17 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  delete from public.inviti where scade_at < now() or usato_da is not null;
  delete from public.inviti_tentativi where at < now() - interval '1 day';
  delete from public.notifiche_coda where created_at < now() - interval '1 day';
$$);

-- 4) Riepilogo della domenica sera: lo crea anche aggiornamenti/14-riepilogo.sql (ogni ora la domenica, UTC: la funzione manda solo alle 20 di Roma)
select cron.schedule('mochi-riepilogo', '7 * * * 0', 'select public.riepilogo_settimanale()');

-- Controllare che giri:  select * from cron.job_run_details order by start_time desc limit 5;
-- Fermarlo:              select cron.unschedule('mochi-promemoria');
-- Cambiare il segreto:   select vault.update_secret((select id from vault.secrets where name = 'mochi_cron_secret'), '<NUOVO>');
--                        (e aggiornalo anche nei secrets della funzione)
