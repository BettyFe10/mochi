-- =========================================================
-- MOCHI - "La tua mascotte sente la tua mancanza" (notifica dopo 2 giorni senza aprire l'app)
-- Una riga per persona (attivita_utente): l'ultimo accesso, l'ultimo avviso mandato e due interruttori.
--   mi_manca:      l'avviso e' acceso (di default si; si spegne in Impostazioni)
--   avviso_visto:  la persona ha visto l'avviso che spiega questa notifica (finche' non lo vede, il server non scrive)
-- Si manda UNA volta per assenza: dopo 2 giorni senza aprire l'app, alle 18:00 ora di Roma, solo a chi ha le notifiche
-- attive. Per riceverne un'altra bisogna riaprire l'app e poi sparire di nuovo per 2 giorni. Dopo 30 giorni non si scrive piu'.
-- Le persone cambiano solo tramite le funzioni qui sotto (niente scritture dirette); leggono solo la propria riga.
-- Incolla tutto in Supabase > SQL Editor > Run. Si puo' rilanciare. Non tocca nessun dato esistente.
-- (E' incluso anche in schema.sql, punto 27.) L'eliminazione dell'account porta via anche questa riga (on delete cascade).
-- =========================================================
create table if not exists public.attivita_utente (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ultimo_accesso timestamptz not null default now(),
  ultimo_avviso  timestamptz,
  mi_manca       boolean not null default true,
  avviso_visto   boolean not null default false
);
alter table public.attivita_utente enable row level security;
drop policy if exists "attivita_select" on public.attivita_utente;
create policy "attivita_select" on public.attivita_utente for select to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.attivita_utente from public, anon;
revoke all on public.attivita_utente from authenticated;
grant select on public.attivita_utente to authenticated;   -- scrivere solo con le funzioni

-- L'app la chiama quando si apre (al massimo una volta all'ora): aggiorna l'ultimo accesso (al massimo una scrittura al minuto)
-- e dice se mostrare l'avviso e com'e' l'interruttore.
create or replace function public.registra_accesso() returns table (mi_manca boolean, avviso_visto boolean)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  insert into public.attivita_utente as a (user_id, ultimo_accesso) values (uid, now())
    on conflict (user_id) do update set ultimo_accesso = now() where a.ultimo_accesso < now() - interval '1 minute';
  return query select a.mi_manca, a.avviso_visto from public.attivita_utente a where a.user_id = uid;
end $$;
revoke all on function public.registra_accesso() from public, anon;
grant execute on function public.registra_accesso() to authenticated;

-- Interruttore in Impostazioni (e "Spegni" dell'avviso). Scegliere, in un senso o nell'altro, vale come avviso visto.
create or replace function public.imposta_mi_manca(p_attivo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  if p_attivo is null then raise exception 'Valore non valido'; end if;
  insert into public.attivita_utente as a (user_id, mi_manca, avviso_visto) values (uid, p_attivo, true)
    on conflict (user_id) do update set mi_manca = p_attivo, avviso_visto = true;
end $$;
revoke all on function public.imposta_mi_manca(boolean) from public, anon;
grant execute on function public.imposta_mi_manca(boolean) to authenticated;

-- "Ok" sull'avviso: l'avviso e' stato visto e l'interruttore resta com'e'.
create or replace function public.avviso_mi_manca_visto() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  insert into public.attivita_utente as a (user_id, avviso_visto) values (uid, true)
    on conflict (user_id) do update set avviso_visto = true;
end $$;
revoke all on function public.avviso_mi_manca_visto() from public, anon;
grant execute on function public.avviso_mi_manca_visto() to authenticated;

-- Solo per la funzione "send-reminders" (chiave server): chi va avvisato adesso. p_ora = l'ora di Roma in cui si scrive
-- (18 di default; -1 = qualsiasi ora, serve solo ai test). Non segna niente: lo fa mi_manca_segna dopo l'invio.
create or replace function public.mi_manca_da_inviare(p_ora int default 18) returns table (user_id uuid, nome_mascotte text, mascotte text)
language sql stable security definer set search_path = public, auth as $$
  select a.user_id, nullif(btrim(u.raw_user_meta_data->>'nome_mascotte'), ''), u.raw_user_meta_data->>'mascotte'
    from public.attivita_utente a join auth.users u on u.id = a.user_id
   where a.mi_manca and a.avviso_visto
     and a.ultimo_accesso < now() - interval '2 days'
     and a.ultimo_accesso > now() - interval '30 days'
     and (a.ultimo_avviso is null or a.ultimo_avviso < a.ultimo_accesso)
     and (p_ora < 0 or extract(hour from now() at time zone 'Europe/Rome') = p_ora)
     and exists (select 1 from public.push_subscriptions p where p.user_id = a.user_id)
   order by a.ultimo_accesso
   limit 500;
$$;
revoke all on function public.mi_manca_da_inviare(int) from public, anon, authenticated;
grant execute on function public.mi_manca_da_inviare(int) to service_role;

create or replace function public.mi_manca_segna(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.attivita_utente set ultimo_avviso = now() where user_id = any(p_ids);
$$;
revoke all on function public.mi_manca_segna(uuid[]) from public, anon, authenticated;
grant execute on function public.mi_manca_segna(uuid[]) to service_role;

-- CONTROLLO (dopo averlo lanciato, incolla e lancia questa query: ogni colonna deve valere true)
select
  (select relrowsecurity from pg_class where oid = 'public.attivita_utente'::regclass) as rls_accesa,
  not has_table_privilege('anon', 'public.attivita_utente', 'select') as anon_bloccato,
  not has_table_privilege('authenticated', 'public.attivita_utente', 'insert')
    and not has_table_privilege('authenticated', 'public.attivita_utente', 'update') as scritture_solo_con_funzioni,
  has_function_privilege('authenticated', 'public.registra_accesso()', 'execute')
    and not has_function_privilege('anon', 'public.registra_accesso()', 'execute') as funzioni_app,
  has_function_privilege('service_role', 'public.mi_manca_da_inviare(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.mi_manca_da_inviare(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.mi_manca_segna(uuid[])', 'execute') as funzioni_server;
