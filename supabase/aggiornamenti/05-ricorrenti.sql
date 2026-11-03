-- =========================================================
-- MOCHI - Promemoria ricorrenti ("bevi acqua ogni 2 ore", "sgranchisciti ogni ora")
-- Ognuno vede e modifica solo i propri. L'orario del prossimo avviso lo calcola il database,
-- non l'app: nessuno può programmarsi raffiche di notifiche.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 13.)
-- =========================================================

create table if not exists public.ricorrenti (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titolo          text not null,
  emoji           text not null default '💧',
  ogni_minuti     int  not null default 120,
  dalle           time not null default '09:00',
  alle            time not null default '21:00',
  giorni          int[] not null default '{1,2,3,4,5,6,7}',   -- 1 = lunedì ... 7 = domenica
  fuso            text not null default 'Europe/Rome',
  attiva          boolean not null default true,
  prossimo_invio  timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists ricorrenti_invio_idx on public.ricorrenti (prossimo_invio) where attiva;
create index if not exists ricorrenti_user_idx on public.ricorrenti (user_id);

alter table public.ricorrenti drop constraint if exists ricorrenti_ok;
alter table public.ricorrenti add constraint ricorrenti_ok check (
  char_length(btrim(titolo)) between 1 and 80
  and char_length(emoji) between 1 and 8 and emoji !~ '[<>"''&A-Za-z0-9]'
  and ogni_minuti between 30 and 1440               -- al massimo una ogni mezz'ora
  and dalle < alle
  and cardinality(giorni) between 1 and 7 and giorni <@ array[1,2,3,4,5,6,7]
  and char_length(fuso) <= 40
);

-- Prossimo orario utile: allineato all'inizio della fascia (9:00, 11:00, 13:00...),
-- solo nei giorni scelti e dentro la fascia oraria, nel fuso orario di chi l'ha creato.
create or replace function public.prossima_ricorrenza(p_da timestamptz, p_ogni int, p_dalle time, p_alle time, p_giorni int[], p_fuso text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare loc timestamp; giorno date; inizio timestamp; cand timestamp; k int; i int;
begin
  loc := p_da at time zone p_fuso;
  giorno := loc::date;
  for i in 0..8 loop
    inizio := giorno + p_dalle;
    if extract(isodow from giorno)::int = any(p_giorni) then
      if loc < inizio then cand := inizio;
      else
        k := ceil(extract(epoch from (loc - inizio)) / (p_ogni * 60.0));
        cand := inizio + make_interval(mins => k * p_ogni);
        if cand <= loc then cand := cand + make_interval(mins => p_ogni); end if;
      end if;
      if cand::date = giorno and cand::time <= p_alle then
        return cand at time zone p_fuso;
      end if;
    end if;
    giorno := giorno + 1;
    loc := giorno::timestamp;   -- dal giorno dopo si riparte dall'inizio della fascia
  end loop;
  return null;
end $$;
revoke all on function public.prossima_ricorrenza(timestamptz, int, time, time, int[], text) from public, anon, authenticated;

-- Chi crea è sempre chi è collegato; il prossimo invio lo decide il database; massimo 10 a testa
create or replace function public.ricorrenti_controlli() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    if (select count(*) from public.ricorrenti where user_id = new.user_id) >= 10 then
      raise exception 'Puoi avere al massimo 10 promemoria ricorrenti';
    end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.fuso) then new.fuso := 'Europe/Rome'; end if;
  new.titolo := btrim(new.titolo);
  new.prossimo_invio := case when new.attiva
    then public.prossima_ricorrenza(now(), new.ogni_minuti, new.dalle, new.alle, new.giorni, new.fuso) else null end;
  return new;
end $$;
revoke all on function public.ricorrenti_controlli() from public, anon, authenticated;
drop trigger if exists ricorrenti_controlli on public.ricorrenti;
create trigger ricorrenti_controlli before insert or update on public.ricorrenti for each row execute function public.ricorrenti_controlli();

alter table public.ricorrenti enable row level security;
drop policy if exists "solo_mie_ricorrenti" on public.ricorrenti;
create policy "solo_mie_ricorrenti" on public.ricorrenti
  for all to authenticated
  using (user_id = auth.uid() and public.origine_consentita())
  with check (user_id = auth.uid() and public.origine_consentita());
revoke all on public.ricorrenti from anon;
grant select, insert, update, delete on public.ricorrenti to authenticated;
revoke truncate, references, trigger on public.ricorrenti from anon, authenticated;

-- Per il server: quelle da mandare adesso (max 10 a persona per giro). Quelle rimaste indietro
-- di oltre un'ora (es. server fermo) non vengono mandate in ritardo: si passa alla prossima.
create or replace function public.ricorrenti_da_inviare() returns table (id uuid, user_id uuid, titolo text, emoji text, ogni_minuti int)
language plpgsql security definer set search_path = public as $$
begin
  return query
    with scelte as (
      select r.id, (r.prossimo_invio > now() - interval '1 hour') as puntuale from (
        select x.*, row_number() over (partition by x.user_id order by x.prossimo_invio) rn
          from public.ricorrenti x where x.attiva and x.prossimo_invio is not null and x.prossimo_invio <= now()
      ) r where r.rn <= 10
    ), aggiornate as (
      update public.ricorrenti t set prossimo_invio = public.prossima_ricorrenza(now(), t.ogni_minuti, t.dalle, t.alle, t.giorni, t.fuso)
        from scelte s where t.id = s.id
      returning t.id, t.user_id, t.titolo, t.emoji, t.ogni_minuti, s.puntuale
    )
    select a.id, a.user_id, a.titolo, a.emoji, a.ogni_minuti from aggiornate a where a.puntuale;
end $$;
revoke all on function public.ricorrenti_da_inviare() from public, anon, authenticated;
grant execute on function public.ricorrenti_da_inviare() to service_role;
