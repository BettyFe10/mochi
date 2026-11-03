-- =========================================================
-- MOCHI - "Com'è andata la giornata?"
-- Un umore al giorno (da 1 a 5) con una nota facoltativa. Ognuno vede solo il proprio.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 15.)
-- =========================================================
create table if not exists public.umori (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  giorno      date not null,
  livello     smallint not null,
  nota        text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, giorno)
);
alter table public.umori drop constraint if exists umori_ok;
alter table public.umori add constraint umori_ok check (
  livello between 1 and 5
  and (nota is null or char_length(nota) <= 200)
  and giorno between date '2000-01-01' and date '2100-12-31'
);

-- Chi scrive è sempre chi è collegato; l'autore non si cambia
create or replace function public.umori_autore() returns trigger
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
revoke all on function public.umori_autore() from public, anon, authenticated;
drop trigger if exists umori_autore on public.umori;
create trigger umori_autore before insert or update on public.umori for each row execute function public.umori_autore();

alter table public.umori enable row level security;
drop policy if exists "solo_miei_umori" on public.umori;
create policy "solo_miei_umori" on public.umori
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.umori from anon;
grant select, insert, update, delete on public.umori to authenticated;
revoke truncate, references, trigger on public.umori from anon, authenticated;
