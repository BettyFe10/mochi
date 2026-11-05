-- =========================================================
-- MOCHI - Spese (budget tracker)
-- Ognuno vede e modifica solo le proprie spese. Nessun altro, nemmeno nelle liste condivise.
--   spese:              una riga per spesa (importo in centesimi, categoria, giorno, nota facoltativa)
--   spese_impostazioni: il budget mensile facoltativo (una riga per persona)
-- Limiti: importo da 0,01 a 999.999,99 euro, nota fino a 120 caratteri, categorie fisse, al massimo 5000 spese a persona.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 20.)
-- =========================================================
create table if not exists public.spese (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  giorno        date not null default current_date,
  importo_cent  integer not null,                -- 1250 = 12,50 euro
  categoria     text not null default 'altro',
  nota          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists spese_user_giorno_idx on public.spese (user_id, giorno);
alter table public.spese drop constraint if exists spese_ok;
alter table public.spese add constraint spese_ok check (
  importo_cent between 1 and 99999999
  and categoria in ('spesa', 'casa', 'bollette', 'trasporti', 'ristoranti', 'svago', 'salute', 'abbigliamento', 'regali', 'animali', 'altro')
  and (nota is null or char_length(nota) <= 120)
  and giorno between date '2000-01-01' and date '2100-12-31'
);

create table if not exists public.spese_impostazioni (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  budget_cent  integer,                          -- vuoto = nessun budget
  updated_at   timestamptz not null default now()
);
alter table public.spese_impostazioni drop constraint if exists spese_impostazioni_ok;
alter table public.spese_impostazioni add constraint spese_impostazioni_ok check (budget_cent is null or budget_cent between 1 and 99999999);

-- Chi scrive è sempre chi è collegato; autore, id e data di creazione non si cambiano; massimo 5000 spese a testa
create or replace function public.spese_controlli() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := now();
    if (select count(*) from public.spese where user_id = new.user_id) >= 5000 then
      raise exception 'Hai raggiunto il limite di 5000 spese';
    end if;
  else
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.spese_controlli() from public, anon, authenticated;
drop trigger if exists spese_controlli on public.spese;
create trigger spese_controlli before insert or update on public.spese for each row execute function public.spese_controlli();

create or replace function public.spese_impostazioni_autore() returns trigger
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
revoke all on function public.spese_impostazioni_autore() from public, anon, authenticated;
drop trigger if exists spese_impostazioni_autore on public.spese_impostazioni;
create trigger spese_impostazioni_autore before insert or update on public.spese_impostazioni for each row execute function public.spese_impostazioni_autore();

alter table public.spese enable row level security;
alter table public.spese_impostazioni enable row level security;
drop policy if exists "solo_mie_spese" on public.spese;
create policy "solo_mie_spese" on public.spese
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
drop policy if exists "solo_mie_impostazioni_spese" on public.spese_impostazioni;
create policy "solo_mie_impostazioni_spese" on public.spese_impostazioni
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.spese, public.spese_impostazioni from anon;
grant select, insert, update, delete on public.spese, public.spese_impostazioni to authenticated;
revoke truncate, references, trigger on public.spese, public.spese_impostazioni from anon, authenticated;

-- Controllo: deve rispondere 2
--   select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('spese', 'spese_impostazioni');
