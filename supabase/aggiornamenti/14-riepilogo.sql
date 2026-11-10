-- =========================================================
-- MOCHI - Riepilogo della domenica sera
-- Ogni domenica alle 20 (ora italiana) chi ha le notifiche attive riceve:
--   "La tua settimana: 12 cose fatte, 5 giorni attivi. Settimana prossima: 4 turni (32 h). Spese: 145,20 €"
-- Solo i numeri, solo dei moduli che la persona usa (moduli nell'account); col modulo "riepilogo" spento, niente.
-- Non serve cambiare la funzione che manda le notifiche: il riepilogo entra nella coda che già usa (notifiche_coda).
-- Una sola volta per settimana per persona (tabella riepilogo_inviati), anche se la funzione gira più volte.
-- Il cron di Supabase va in UTC: gira ogni ora la domenica e la funzione controlla che a Roma siano le 20
-- (così l'ora legale e quella solare vanno da sole).
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca i dati esistenti.
-- (È incluso anche in schema.sql, punto 22.)
-- =========================================================
create table if not exists public.riepilogo_inviati (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  settimana   date not null,                  -- la domenica dell'ultimo riepilogo
  inviato_at  timestamptz not null default now()
);
alter table public.riepilogo_inviati enable row level security;
-- nessuno la legge o la scrive dall'app: la usa solo la funzione qui sotto
revoke all on public.riepilogo_inviati from anon, authenticated;

-- E' domenica sera, le 20 a Roma?
create or replace function public.riepilogo_e_ora(p_ora timestamptz) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from (p_ora at time zone 'Europe/Rome')) = 7
     and extract(hour from (p_ora at time zone 'Europe/Rome')) = 20;
$$;

-- I numeri di UNA persona per la settimana che finisce la domenica p_dom (lunedì-domenica, giorni di Roma)
create or replace function public.riepilogo_numeri(p_user uuid, p_dom date) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  lun date := p_dom - 6; md jsonb; fatte int := 0; attivi int := 0; spese bigint := 0; nturni int := 0; minuti int := 0;
  imp record; d date; k text; t jsonb; dur int; lungo int;
begin
  select coalesce(u.raw_user_meta_data -> 'moduli', '{}'::jsonb) into md from auth.users u where u.id = p_user;
  md := coalesce(md, '{}'::jsonb);
  -- cose fatte: le spuntate da lei (anche nelle liste condivise conta chi ha spuntato)
  select count(*) into fatte from public.items i
   where i.done and i.kind <> 'note' and coalesce(i.done_by, i.user_id) = p_user
     and (i.done_at at time zone 'Europe/Rome')::date between lun and p_dom;
  if coalesce(md ->> 'serie', 'true') <> 'false' then
    select count(*) into attivi from public.giorni_attivi g where g.user_id = p_user and g.giorno between lun and p_dom;
  end if;
  if coalesce(md ->> 'spese', 'true') <> 'false' then
    select coalesce(sum(s.importo_cent), 0) into spese from public.spese s where s.user_id = p_user and s.giorno between lun and p_dom;
  end if;
  -- turni della settimana dopo: prima i cambi a mano, poi il ciclo che si ripete
  if coalesce(md ->> 'turni', 'true') <> 'false' then
    select ti.tipi, ti.ciclo, ti.ciclo_inizio into imp from public.turni_impostazioni ti where ti.user_id = p_user;
    if found then
      lungo := jsonb_array_length(imp.ciclo);
      for d in select x::date from generate_series(p_dom + 1, p_dom + 7, interval '1 day') x loop
        select tu.tipo into k from public.turni tu where tu.user_id = p_user and tu.giorno = d;
        if not found then
          k := case when lungo > 0 and imp.ciclo_inizio is not null and d >= imp.ciclo_inizio then imp.ciclo ->> ((d - imp.ciclo_inizio) % lungo) end;
        end if;
        if k is not null and k <> '' then
          select x into t from jsonb_array_elements(imp.tipi) x where x ->> 'k' = k limit 1;
          if t is not null and coalesce(t ->> 'inizio', '') ~ '^\d\d:\d\d$' and coalesce(t ->> 'fine', '') ~ '^\d\d:\d\d$' then
            dur := (split_part(t ->> 'fine', ':', 1)::int * 60 + split_part(t ->> 'fine', ':', 2)::int)
                 - (split_part(t ->> 'inizio', ':', 1)::int * 60 + split_part(t ->> 'inizio', ':', 2)::int);
            if dur <= 0 then dur := dur + 1440; end if;           -- turno che passa la mezzanotte
            dur := greatest(0, dur - case when coalesce(t ->> 'pausa', '') ~ '^\d{1,4}$' then (t ->> 'pausa')::int else 0 end); -- pausa strana = nessuna pausa
            nturni := nturni + 1; minuti := minuti + dur;
          end if;
        end if;
      end loop;
    end if;
  end if;
  return jsonb_build_object('fatte', fatte, 'attivi', attivi, 'spese', spese, 'turni', nturni, 'minuti', minuti,
    'usa_serie', coalesce(md ->> 'serie', 'true') <> 'false', 'usa_spese', coalesce(md ->> 'spese', 'true') <> 'false', 'usa_turni', coalesce(md ->> 'turni', 'true') <> 'false');
end $$;

-- Il testo della notifica (solo numeri)
create or replace function public.riepilogo_testo(n jsonb) returns text
language sql immutable set search_path = public as $$
  select 'La tua settimana: ' || (n ->> 'fatte') || case when (n ->> 'fatte')::int = 1 then ' cosa fatta' else ' cose fatte' end
    || case when (n ->> 'usa_serie')::boolean then ', ' || (n ->> 'attivi') || case when (n ->> 'attivi')::int = 1 then ' giorno attivo' else ' giorni attivi' end else '' end || '.'
    || case when (n ->> 'usa_turni')::boolean and (n ->> 'turni')::int > 0 then ' Settimana prossima: ' || (n ->> 'turni') || case when (n ->> 'turni')::int = 1 then ' turno' else ' turni' end
         || ' (' || ((n ->> 'minuti')::int / 60) || ' h' || case when (n ->> 'minuti')::int % 60 > 0 then ' ' || lpad(((n ->> 'minuti')::int % 60)::text, 2, '0') else '' end || ').' else '' end
    || case when (n ->> 'usa_spese')::boolean and (n ->> 'spese')::bigint > 0 then ' Spese: '
         || regexp_replace(((n ->> 'spese')::bigint / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') || ',' || lpad(((n ->> 'spese')::bigint % 100)::text, 2, '0') || ' €' else '' end;
$$;

-- Ogni domenica alle 20 (a Roma): un riepilogo a testa per chi ha le notifiche attive e il modulo acceso
create or replace function public.riepilogo_settimanale(p_ora timestamptz default now()) returns integer
language plpgsql security definer set search_path = public, auth as $$
declare dom date; u record; n jsonb; quanti int := 0; segnato int;
begin
  if not public.riepilogo_e_ora(p_ora) then return 0; end if;
  dom := (p_ora at time zone 'Europe/Rome')::date;
  for u in
    select distinct s.user_id from public.push_subscriptions s join auth.users us on us.id = s.user_id
     where coalesce(us.raw_user_meta_data -> 'moduli' ->> 'riepilogo', 'true') <> 'false'
       and not exists (select 1 from public.riepilogo_inviati r where r.user_id = s.user_id and r.settimana >= dom)
     limit 10000
  loop
    -- prima segno "fatto" per questa domenica: se la funzione gira due volte, il secondo giro salta
    insert into public.riepilogo_inviati (user_id, settimana) values (u.user_id, dom)
      on conflict (user_id) do update set settimana = excluded.settimana, inviato_at = now() where public.riepilogo_inviati.settimana < excluded.settimana;
    get diagnostics segnato = row_count;
    if segnato = 0 then continue; end if;
    -- i dati strani di una persona (es. un tipo di turno scritto a mano) non devono fermare il riepilogo degli altri
    begin
      n := public.riepilogo_numeri(u.user_id, dom);
    exception when others then
      continue;
    end;
    -- settimana vuota: niente notifica
    if (n ->> 'fatte')::int = 0 and (n ->> 'attivi')::int = 0 and (n ->> 'turni')::int = 0 and (n ->> 'spese')::bigint = 0 then continue; end if;
    insert into public.notifiche_coda (destinatario, titolo, corpo)
      select u.user_id, '🌙 La tua settimana', public.riepilogo_testo(n)
       where (select count(*) from public.notifiche_coda q where q.destinatario = u.user_id) < 100;
    quanti := quanti + 1;
  end loop;
  return quanti;
end $$;
-- solo il database (il cron) le usa: nessun utente può chiamarle o leggere i numeri di un altro
revoke all on function public.riepilogo_settimanale(timestamptz), public.riepilogo_numeri(uuid, date), public.riepilogo_testo(jsonb), public.riepilogo_e_ora(timestamptz) from public, anon, authenticated;

-- Il cron (se pg_cron è attivo): ogni ora, la domenica (UTC); la funzione manda solo quando a Roma sono le 20
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mochi-riepilogo', '7 * * * 0', 'select public.riepilogo_settimanale()');
  end if;
end $$;

-- Controllo: deve rispondere 1 riga con tabella = 1, funzione = 1, cron = 1 (cron = 0 se pg_cron non è attivo)
--   select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'riepilogo_inviati') as tabella,
--          (select count(*) from pg_proc where proname = 'riepilogo_settimanale') as funzione,
--          (select count(*) from cron.job where jobname = 'mochi-riepilogo') as cron;
-- Prova a mano (non manda niente se non è domenica alle 20 a Roma):  select public.riepilogo_settimanale();
