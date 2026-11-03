-- =========================================================
-- MOCHI - Turni di lavoro
-- Ognuno vede e modifica solo i propri turni. Nessun altro, nemmeno nelle liste condivise.
--   turni_impostazioni: i tipi di turno (Mattina, Notte...) e il ciclo che si ripete
--   turni:              i cambi fatti a mano su un singolo giorno (ferie, scambi...)
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 17.)
-- =========================================================
create table if not exists public.turni_impostazioni (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tipi          jsonb not null default '[]'::jsonb,
  ciclo         jsonb not null default '[]'::jsonb,
  ciclo_inizio  date,
  updated_at    timestamptz not null default now()
);
alter table public.turni_impostazioni drop constraint if exists turni_impostazioni_ok;
alter table public.turni_impostazioni add constraint turni_impostazioni_ok check (
  jsonb_typeof(tipi) = 'array' and jsonb_array_length(tipi) <= 12 and octet_length(tipi::text) <= 4000
  and jsonb_typeof(ciclo) = 'array' and jsonb_array_length(ciclo) <= 62 and octet_length(ciclo::text) <= 1200
  and (ciclo_inizio is null or ciclo_inizio between date '2000-01-01' and date '2100-12-31')
);

create table if not exists public.turni (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  giorno      date not null,
  tipo        text not null,               -- codice del tipo di turno; '' = riposo
  updated_at  timestamptz not null default now(),
  primary key (user_id, giorno)
);
alter table public.turni drop constraint if exists turni_ok;
alter table public.turni add constraint turni_ok check (
  tipo ~ '^[a-z0-9]{0,8}$'
  and giorno between date '2000-01-01' and date '2100-12-31'
);

-- Chi scrive è sempre chi è collegato; l'autore non si cambia
create or replace function public.turni_autore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
  else
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.turni_autore() from public, anon, authenticated;
drop trigger if exists turni_autore on public.turni;
create trigger turni_autore before insert or update on public.turni for each row execute function public.turni_autore();
drop trigger if exists turni_impostazioni_autore on public.turni_impostazioni;
create trigger turni_impostazioni_autore before insert or update on public.turni_impostazioni for each row execute function public.turni_autore();

alter table public.turni enable row level security;
alter table public.turni_impostazioni enable row level security;
drop policy if exists "solo_miei_turni" on public.turni;
create policy "solo_miei_turni" on public.turni
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
drop policy if exists "solo_mie_impostazioni_turni" on public.turni_impostazioni;
create policy "solo_mie_impostazioni_turni" on public.turni_impostazioni
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.turni, public.turni_impostazioni from anon;
grant select, insert, update, delete on public.turni, public.turni_impostazioni to authenticated;
revoke truncate, references, trigger on public.turni, public.turni_impostazioni from anon, authenticated;

-- Controllo: deve rispondere 2
--   select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('turni', 'turni_impostazioni');
