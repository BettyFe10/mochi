-- =========================================================
-- MOCHI - Il ciclo dei turni può finire (v45)
-- Prima il ciclo dei turni si ripeteva per sempre. Ora si può scegliere l'ultimo giorno ("fino a quando"):
-- dopo quel giorno il ciclo non dice più niente (i cambi fatti a mano restano). Vuoto = per sempre, come prima.
--   turni_impostazioni.ciclo_fine: data facoltativa, tra il 2000 e il 2100.
--   riepilogo_numeri(): i turni della settimana dopo rispettano la data di fine.
-- Chi ha la app vecchia aperta continua a vedere il ciclo senza fine finché non la riapre (i dati non si rovinano).
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Prima lanciare 14-riepilogo.sql e 09-turni.sql (se non già fatto).
-- (È incluso anche in schema.sql, punto 17 e 22.)
-- =========================================================

alter table public.turni_impostazioni add column if not exists ciclo_fine date;
alter table public.turni_impostazioni drop constraint if exists turni_impostazioni_ok;
alter table public.turni_impostazioni add constraint turni_impostazioni_ok check (
  jsonb_typeof(tipi) = 'array' and jsonb_array_length(tipi) <= 12 and octet_length(tipi::text) <= 4000
  and jsonb_typeof(ciclo) = 'array' and jsonb_array_length(ciclo) <= 62 and octet_length(ciclo::text) <= 1200
  and (ciclo_inizio is null or ciclo_inizio between date '2000-01-01' and date '2100-12-31')
  and (ciclo_fine is null or ciclo_fine between date '2000-01-01' and date '2100-12-31')
);

-- I numeri del riepilogo della domenica: i turni della settimana dopo si fermano alla data di fine del ciclo
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
    select ti.tipi, ti.ciclo, ti.ciclo_inizio, ti.ciclo_fine into imp from public.turni_impostazioni ti where ti.user_id = p_user;
    if found then
      lungo := jsonb_array_length(imp.ciclo);
      for d in select x::date from generate_series(p_dom + 1, p_dom + 7, interval '1 day') x loop
        select tu.tipo into k from public.turni tu where tu.user_id = p_user and tu.giorno = d;
        if not found then
          k := case when lungo > 0 and imp.ciclo_inizio is not null and d >= imp.ciclo_inizio and (imp.ciclo_fine is null or d <= imp.ciclo_fine) then imp.ciclo ->> ((d - imp.ciclo_inizio) % lungo) end;
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

revoke all on function public.riepilogo_numeri(uuid, date) from public, anon, authenticated;

-- Controllo: deve rispondere 1 riga con colonna = 1, vincolo = 1 e funzione_aggiornata = true
--   select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'turni_impostazioni' and column_name = 'ciclo_fine') as colonna,
--          (select count(*) from pg_constraint where conname = 'turni_impostazioni_ok' and pg_get_constraintdef(oid) like '%ciclo_fine%') as vincolo,
--          (select prosrc like '%ciclo_fine%' from pg_proc where proname = 'riepilogo_numeri') as funzione_aggiornata;
