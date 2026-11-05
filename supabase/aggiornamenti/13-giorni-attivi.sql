-- =========================================================
-- MOCHI - Giorni attivi (per la "Serie di giorni")
-- Un giorno è "attivo" quando hai spuntato almeno una cosa da fare o un appuntamento.
-- Si salva solo la data (niente titoli, niente orari): così la serie e il record non spariscono
-- se poi elimini o togli la spunta a una voce.
-- Ognuno vede e scrive solo i propri giorni. Nessun altro, nemmeno nelle liste condivise.
-- Limiti: una riga per giorno, date tra il 2000 e domani, al massimo 10000 giorni a persona.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 21.)
-- =========================================================
create table if not exists public.giorni_attivi (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  giorno      date not null,                 -- data del dispositivo (giorno locale), non un orario
  created_at  timestamptz not null default now(),
  primary key (user_id, giorno)
);
alter table public.giorni_attivi drop constraint if exists giorni_attivi_ok;
alter table public.giorni_attivi add constraint giorni_attivi_ok check (giorno between date '2000-01-01' and date '2100-12-31');

-- Chi scrive è sempre chi è collegato; niente giorni nel futuro (domani al massimo, per i fusi orari);
-- al massimo 10000 giorni a testa (oltre 27 anni di serie)
create or replace function public.giorni_attivi_controlli() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
  else
    new.user_id := old.user_id;
  end if;
  new.created_at := now();
  if new.giorno > (now() at time zone 'utc')::date + 1 then
    raise exception 'Giorno nel futuro';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.giorni_attivi where user_id = new.user_id) >= 10000
     and not exists (select 1 from public.giorni_attivi where user_id = new.user_id and giorno = new.giorno) then
    raise exception 'Hai raggiunto il limite di 10000 giorni';
  end if;
  return new;
end $$;
revoke all on function public.giorni_attivi_controlli() from public, anon, authenticated;
drop trigger if exists giorni_attivi_controlli on public.giorni_attivi;
create trigger giorni_attivi_controlli before insert or update on public.giorni_attivi for each row execute function public.giorni_attivi_controlli();

alter table public.giorni_attivi enable row level security;
drop policy if exists "solo_miei_giorni" on public.giorni_attivi;
create policy "solo_miei_giorni" on public.giorni_attivi
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
-- l'app aggiunge i giorni (se c'è già, non fa niente) e li legge; un giorno non si modifica
revoke all on public.giorni_attivi from anon;
revoke update, truncate, references, trigger on public.giorni_attivi from anon, authenticated;
grant select, insert, delete on public.giorni_attivi to authenticated;

-- Controllo: deve rispondere 1 riga con rls = true e permessi "DELETE, INSERT, SELECT"
--   select c.relrowsecurity as rls,
--          (select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants
--            where table_schema = 'public' and table_name = 'giorni_attivi' and grantee = 'authenticated') as permessi
--   from pg_class c where c.oid = 'public.giorni_attivi'::regclass;
