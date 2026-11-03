-- =========================================================
-- MOCHI - Ottimizzazione del database
-- Non cancella e non modifica nessuna voce. Si può rilanciare.
-- Cosa fa:
--   1) regole di accesso più leggere (stesse regole, calcolate una volta per richiesta invece che per ogni riga)
--   2) il controllo dei promemoria chiama il server SOLO quando c'è davvero qualcosa da mandare
--      (prima: 1.440 chiamate al giorno anche a vuoto)
--   3) pulizia notturna dei registri che crescono da soli
-- (I punti 1 e 2 sono inclusi anche in schema.sql, punto 14.)
-- =========================================================

-- 1) Regole di accesso: "(select ...)" fa calcolare utente e sito una volta sola per richiesta
drop policy if exists "voci_mie_o_condivise" on public.items;
create policy "voci_mie_o_condivise" on public.items
  for all to authenticated
  using ((select public.origine_consentita()) and (
    (lista_id is null and user_id = (select auth.uid())) or (lista_id is not null and public.sono_membro(lista_id))))
  with check ((select public.origine_consentita()) and (
    (lista_id is null and user_id = (select auth.uid())) or (lista_id is not null and public.sono_membro(lista_id))));

drop policy if exists "solo_proprietaria_push" on public.push_subscriptions;
create policy "solo_proprietaria_push" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));

drop policy if exists "solo_mie_ricorrenti" on public.ricorrenti;
create policy "solo_mie_ricorrenti" on public.ricorrenti
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));

-- Indici per i controlli più frequenti
create index if not exists items_dovuti_idx on public.items (remind_at) where reminded = false and done = false;
create index if not exists notifiche_coda_created_idx on public.notifiche_coda (created_at);

-- 2) C'è qualcosa da mandare adesso? (domanda velocissima, usata dal controllo di ogni minuto)
create or replace function public.ci_sono_invii() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.items where reminded = false and done = false and remind_at is not null and remind_at <= now())
      or exists (select 1 from public.notifiche_coda)
      or exists (select 1 from public.ricorrenti where attiva and prossimo_invio is not null and prossimo_invio <= now());
$$;
revoke all on function public.ci_sono_invii() from public, anon, authenticated;

-- Il controllo di ogni minuto resta com'è (stessa chiave, stesso segreto), ma chiama il server
-- solo se ci_sono_invii() risponde sì. Se è già stato modificato, non lo tocca di nuovo.
do $$
declare j record; nuovo text;
begin
  select jobid, command into j from cron.job where jobname = 'mochi-promemoria';
  if j.jobid is null then raise notice 'Controllo promemoria non trovato: nulla da fare'; return; end if;
  if position('ci_sono_invii' in j.command) > 0 then raise notice 'Già ottimizzato'; return; end if;
  nuovo := regexp_replace(j.command, '^\s*select\s+net\.http_post', 'perform net.http_post', 'i');
  if nuovo = j.command then raise exception 'Formato del controllo inatteso: non lo modifico'; end if;
  nuovo := 'do $m$ begin if public.ci_sono_invii() then ' || regexp_replace(nuovo, ';\s*$', '') || '; end if; end $m$;';
  perform cron.alter_job(j.jobid, command := nuovo);
end $$;

-- 3) Pulizia ogni notte alle 3:17 (ora del server): registri del cron, inviti scaduti, tentativi e notifiche vecchie
select cron.schedule('mochi-pulizia', '17 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  delete from public.inviti where scade_at < now() or usato_da is not null;
  delete from public.inviti_tentativi where at < now() - interval '1 day';
  delete from public.notifiche_coda where created_at < now() - interval '1 day';
$$);

-- Controllo: deve comparire "ci_sono_invii" nel primo e il job di pulizia nel secondo
--   select jobname, schedule, left(command, 80) from cron.job order by jobid;
