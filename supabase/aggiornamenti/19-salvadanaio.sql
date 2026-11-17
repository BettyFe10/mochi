-- =========================================================
-- MOCHI - Salvadanaio ("Sto conservando per...")
-- Due tabelle, separate dalle spese (i risparmi non entrano nei totali del mese):
--   salvadanai:       le mete (emoji, nome, nota, obiettivo in euro facoltativo)
--   salvadanaio_mov:  il registro dei versamenti (+) e dei prelievi (-). Ogni riga ha "quando" (la data e l'ora del versamento:
--                     di solito adesso, ma si puo' scegliere un'altra data se lo registri dopo, e correggerla in seguito)
--                     e created_at (quando e' stata scritta, messa dal server, non si cambia: e' la traccia vera)
-- Del movimento si possono cambiare solo la data (quando) e la nota; per correggere un importo si toglie e si rifa'.
-- Ognuno vede e scrive solo le proprie righe. Nessun altro, nemmeno nelle liste condivise.
-- Limiti: 10 mete a persona, 1000 movimenti a meta, importo da 1 centesimo a 10 milioni di euro,
--         non si preleva piu' di quello che c'e' nella meta.
-- Incolla tutto in Supabase > SQL Editor > Run. Si puo' rilanciare. Non tocca nessun dato esistente.
-- (E' incluso anche in schema.sql, punto 26.) L'eliminazione dell'account porta via anche questi dati (on delete cascade).
-- =========================================================
create table if not exists public.salvadanai (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome           text not null,
  emoji          text not null default '🐷',
  nota           text,
  obiettivo_cent bigint,                          -- facoltativo: senza, la meta e' solo un contatore
  created_at     timestamptz not null default now()
);
create index if not exists salvadanai_user_idx on public.salvadanai (user_id, created_at);
alter table public.salvadanai drop constraint if exists salvadanai_ok;
alter table public.salvadanai add constraint salvadanai_ok check (
  char_length(btrim(nome)) between 1 and 60
  and char_length(emoji) between 1 and 16 and emoji !~ '[\x00-\x1f<>&"]'
  and (nota is null or char_length(nota) <= 300)
  and (obiettivo_cent is null or obiettivo_cent between 1 and 1000000000)
);

create table if not exists public.salvadanaio_mov (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  salvadanaio_id uuid not null references public.salvadanai(id) on delete cascade,
  importo_cent   bigint not null,                 -- positivo = versamento, negativo = prelievo
  nota           text,
  quando         timestamptz not null default now(),  -- data e ora del versamento: si puo' scegliere e correggere
  created_at     timestamptz not null default now()   -- quando e' stato scritto: lo mette il server
);
alter table public.salvadanaio_mov add column if not exists quando timestamptz not null default now();
create index if not exists salvadanaio_mov_meta_idx on public.salvadanaio_mov (salvadanaio_id, quando);
create index if not exists salvadanaio_mov_user_idx on public.salvadanaio_mov (user_id);
alter table public.salvadanaio_mov drop constraint if exists salvadanaio_mov_ok;
alter table public.salvadanaio_mov add constraint salvadanaio_mov_ok check (
  importo_cent <> 0 and importo_cent between -1000000000 and 1000000000
  and (nota is null or char_length(nota) <= 120)
  and quando between timestamptz '2000-01-01' and timestamptz '2100-12-31'
);

-- Mete: chi scrive e' sempre chi e' collegato; id e data non si cambiano; al massimo 10 mete a testa.
-- Niente security definer: la conta vede solo le righe di chi scrive (RLS).
create or replace function public.salvadanai_controlli() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := now();
    if (select count(*) from public.salvadanai where user_id = new.user_id) >= 10 then
      raise exception 'Hai raggiunto il limite di 10 mete del salvadanaio';
    end if;
  else
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.nome := btrim(new.nome);
  return new;
end $$;
revoke all on function public.salvadanai_controlli() from public, anon, authenticated;
drop trigger if exists salvadanai_controlli on public.salvadanai;
create trigger salvadanai_controlli before insert or update on public.salvadanai for each row execute function public.salvadanai_controlli();

-- Movimenti: la meta deve essere di chi scrive; created_at lo mette il server; "quando" e' scelto da chi scrive ma non
-- puo' stare piu' di un giorno nel futuro ne' piu' di 10 anni nel passato; dopo, si possono cambiare solo "quando" e la nota;
-- al massimo 1000 movimenti a meta; il saldo non va sotto zero (la riga della meta si blocca un attimo
-- per non farsi sorpassare da due prelievi nello stesso istante).
create or replace function public.salvadanaio_mov_controlli() returns trigger
language plpgsql set search_path = public as $$
declare saldo bigint;
begin
  if tg_op = 'UPDATE' then
    -- cambiano solo la data e la nota: tutto il resto resta com'era
    new.id := old.id; new.user_id := old.user_id; new.salvadanaio_id := old.salvadanaio_id;
    new.importo_cent := old.importo_cent; new.created_at := old.created_at;
    if new.quando is null then new.quando := old.quando; end if;
    if new.quando > now() + interval '1 day' or new.quando < now() - interval '10 years' then
      raise exception 'Data fuori dai limiti';
    end if;
    return new;
  end if;
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.created_at := now();
  if new.quando is null then new.quando := now(); end if;
  if new.quando > now() + interval '1 day' or new.quando < now() - interval '10 years' then
    raise exception 'Data fuori dai limiti';
  end if;
  perform 1 from public.salvadanai where id = new.salvadanaio_id and user_id = new.user_id for update;
  if not found then raise exception 'Meta non valida'; end if;
  if (select count(*) from public.salvadanaio_mov where salvadanaio_id = new.salvadanaio_id) >= 1000 then
    raise exception 'Hai raggiunto il limite di 1000 movimenti per questa meta';
  end if;
  select coalesce(sum(importo_cent), 0) into saldo from public.salvadanaio_mov where salvadanaio_id = new.salvadanaio_id;
  if saldo + new.importo_cent < 0 then raise exception 'Non puoi prelevare piu'' di quello che hai messo da parte'; end if;
  return new;
end $$;
revoke all on function public.salvadanaio_mov_controlli() from public, anon, authenticated;
drop trigger if exists salvadanaio_mov_controlli on public.salvadanaio_mov;
create trigger salvadanaio_mov_controlli before insert or update on public.salvadanaio_mov for each row execute function public.salvadanaio_mov_controlli();

alter table public.salvadanai enable row level security;
alter table public.salvadanaio_mov enable row level security;
drop policy if exists "salv_select" on public.salvadanai;
drop policy if exists "salv_insert" on public.salvadanai;
drop policy if exists "salv_update" on public.salvadanai;
drop policy if exists "salv_delete" on public.salvadanai;
create policy "salv_select" on public.salvadanai for select to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "salv_insert" on public.salvadanai for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "salv_update" on public.salvadanai for update to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "salv_delete" on public.salvadanai for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
drop policy if exists "smov_select" on public.salvadanaio_mov;
drop policy if exists "smov_insert" on public.salvadanaio_mov;
drop policy if exists "smov_update" on public.salvadanaio_mov;
drop policy if exists "smov_delete" on public.salvadanaio_mov;
create policy "smov_select" on public.salvadanaio_mov for select to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "smov_insert" on public.salvadanaio_mov for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.origine_consentita())
              and exists (select 1 from public.salvadanai s where s.id = salvadanaio_id and s.user_id = (select auth.uid())));
create policy "smov_update" on public.salvadanaio_mov for update to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "smov_delete" on public.salvadanaio_mov for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.salvadanai, public.salvadanaio_mov from public, anon;
revoke truncate, references, trigger on public.salvadanai, public.salvadanaio_mov from authenticated;
revoke update on public.salvadanaio_mov from authenticated;
grant update (quando, nota) on public.salvadanaio_mov to authenticated;   -- del movimento si cambiano solo data e nota
grant select, insert, update, delete on public.salvadanai to authenticated;
grant select, insert, delete on public.salvadanaio_mov to authenticated;

-- CONTROLLO (dopo averlo lanciato, incolla e lancia questa query: ogni colonna deve valere true)
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('salvadanai','salvadanaio_mov') and relrowsecurity) = 2 as rls_accesa,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('salvadanai','salvadanaio_mov')) = 8 as otto_regole,
  not has_table_privilege('anon', 'public.salvadanai', 'select') and not has_table_privilege('anon', 'public.salvadanaio_mov', 'select') as anon_bloccato,
  not has_column_privilege('authenticated', 'public.salvadanaio_mov', 'importo_cent', 'update') as importo_non_modificabile,
  (select count(*) from pg_trigger where tgname in ('salvadanai_controlli','salvadanaio_mov_controlli') and not tgisinternal) = 2 as controlli_attivi;
