-- =========================================================
-- MOCHI - Pet (spunte della routine e storico dei pesi)
-- Una tabella generica: pet_registro. La scheda del pet resta nelle impostazioni, qui ci sono solo
--   tipo 'routine': una riga per voce della routine e per giorno (chiave = id della voce, valore = 1 = fatto)
--   tipo 'peso':    una riga per giorno (chiave = 'kg', valore = chili, da 0,01 a 999,99)
-- Ognuno vede e scrive solo le proprie righe. Nessun altro, nemmeno nelle liste condivise.
-- Limiti: giorno da 5 anni fa a domani, una riga per (tipo, giorno, chiave), al massimo 5000 righe a persona.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 23.)
-- =========================================================
create table if not exists public.pet_registro (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo        text not null,
  giorno      date not null,                 -- data del dispositivo (giorno locale)
  chiave      text not null,
  valore      numeric not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists pet_registro_unico_idx on public.pet_registro (user_id, tipo, giorno, chiave);
create index if not exists pet_registro_user_giorno_idx on public.pet_registro (user_id, giorno);
alter table public.pet_registro drop constraint if exists pet_registro_ok;
alter table public.pet_registro add constraint pet_registro_ok check (
  tipo in ('routine', 'peso')
  and chiave ~ '^[a-z0-9-]{1,24}$'
  and giorno between date '2000-01-01' and date '2100-12-31'
  and (
    (tipo = 'routine' and valore = 1)
    or (tipo = 'peso' and chiave = 'kg' and valore >= 0.01 and valore <= 999.99 and valore = round(valore, 2))
  )
);

-- Chi scrive è sempre chi è collegato; id e data di creazione non si cambiano;
-- giorno da 5 anni fa a domani (UTC, per i fusi orari); al massimo 5000 righe a testa.
-- Niente security definer: la conta vede solo le righe di chi scrive (RLS).
create or replace function public.pet_registro_controlli() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  if (tg_op = 'INSERT' or new.giorno is distinct from old.giorno)
     and (new.giorno > (now() at time zone 'utc')::date + 1
          or new.giorno < (now() at time zone 'utc')::date - 1827) then
    raise exception 'Giorno fuori dai limiti';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.pet_registro where user_id = new.user_id) >= 5000
     and not exists (select 1 from public.pet_registro where user_id = new.user_id and tipo = new.tipo and giorno = new.giorno and chiave = new.chiave) then
    raise exception 'Hai raggiunto il limite di 5000 righe del pet';
  end if;
  return new;
end $$;
revoke all on function public.pet_registro_controlli() from public, anon, authenticated;
drop trigger if exists pet_registro_controlli on public.pet_registro;
create trigger pet_registro_controlli before insert or update on public.pet_registro for each row execute function public.pet_registro_controlli();

alter table public.pet_registro enable row level security;
drop policy if exists "pet_select" on public.pet_registro;
drop policy if exists "pet_insert" on public.pet_registro;
drop policy if exists "pet_update" on public.pet_registro;
drop policy if exists "pet_delete" on public.pet_registro;
create policy "pet_select" on public.pet_registro for select to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "pet_insert" on public.pet_registro for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "pet_update" on public.pet_registro for update to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "pet_delete" on public.pet_registro for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.pet_registro from public, anon;
revoke truncate, references, trigger on public.pet_registro from authenticated;
grant select, insert, update, delete on public.pet_registro to authenticated;

-- Controllo: deve rispondere 1 riga con tabella = 1, rls = true, policy = 4, trigger = 1, anon = 0
--   select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'pet_registro') as tabella,
--          (select relrowsecurity from pg_class where oid = 'public.pet_registro'::regclass) as rls,
--          (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pet_registro') as policy,
--          (select count(*) from pg_trigger where tgrelid = 'public.pet_registro'::regclass and not tgisinternal) as trigger,
--          (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'pet_registro' and grantee in ('anon', 'PUBLIC')) as anon;
