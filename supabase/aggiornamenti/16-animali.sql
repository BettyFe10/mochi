-- =========================================================
-- MOCHI - Più animali (v35)
-- Ogni utente può avere fino a 5 animali, ognuno con la sua scheda (nome, specie, data, veterinario, note, routine).
-- Non c'è un animale "principale" salvato: scadenze, spese, peso e routine dicono a quale animale appartengono
-- (animale_id). Chi non lo dice (app vecchia) resta senza animale: la app le mostra sotto il primo animale.
--   pet_animali:      una riga per animale. Il primo creato è quello di default per la app.
--   pet_registro:     peso e routine per animale (animale_id).
--   items e spese:    animale_id facoltativo (vuoto = senza animale).
-- Eliminare un animale: spariscono il suo peso e la sua routine; scadenze e spese restano senza animale.
-- Migrazione: la scheda attuale (user_metadata.pet) diventa un animale, gli "altri animali" diventano animali
--   senza scheda (solo nome), e i tag della v33 (nel titolo/nota) diventano animale_id. Le righe senza animale
--   vanno al primo animale dell'utente (il più vecchio).
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Prima lanciare 15-pet.sql (se non è già fatto).
-- (È incluso anche in schema.sql, punto 24.)
-- =========================================================

-- 0. Versione precedente di questo script (con "principale"): si toglie, il default si calcola
drop index if exists public.pet_animali_principale_idx;
drop function if exists public.pet_imposta_principale(uuid);

-- 1. Tabella degli animali
create table if not exists public.pet_animali (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome         text not null default '',
  specie       text not null default '',
  dt           text not null default '',              -- '' | 'n' compleanno | 'a' arrivo a casa
  g            integer not null default 0,
  m            integer not null default 0,
  a            integer not null default 0,
  vet          text not null default '',
  tel          text not null default '',
  note         text not null default '',
  routine      jsonb,                                  -- null = routine predefinita della specie
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists pet_animali_user_idx on public.pet_animali (user_id);
alter table public.pet_animali drop column if exists principale; -- versione precedente

alter table public.pet_animali drop constraint if exists pet_animali_ok;
alter table public.pet_animali add constraint pet_animali_ok check (
  char_length(nome) between 0 and 20
  and char_length(specie) <= 20
  and (nome <> '' or specie <> '')
  and specie in ('', 'cane', 'gatto', 'coniglio', 'criceto', 'uccellino', 'pesce', 'rettile', 'altro')
  and dt in ('', 'n', 'a')
  and g between 0 and 31 and m between 0 and 12 and (a = 0 or a between 1980 and 2100)
  and (g = 0 or m > 0)
  and char_length(vet) <= 40
  and (tel = '' or (char_length(tel) <= 20 and tel ~ '^\+?[0-9 ]{3,20}$'))
  and char_length(note) <= 300
  and (routine is null or (jsonb_typeof(routine) = 'array' and jsonb_array_length(routine) <= 8))
);

-- Controlli: id e utente non si cambiano; massimo 5 animali per persona
create or replace function public.pet_animali_controlli() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    if (select count(*) from public.pet_animali where user_id = new.user_id) >= 5 then
      raise exception 'Hai raggiunto il limite di 5 animali';
    end if;
    new.created_at := clock_timestamp();
    new.updated_at := now();
  else
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.pet_animali_controlli() from public, anon, authenticated;
drop trigger if exists pet_animali_controlli on public.pet_animali;
create trigger pet_animali_controlli before insert or update on public.pet_animali for each row execute function public.pet_animali_controlli();

alter table public.pet_animali enable row level security;
drop policy if exists "animali_select" on public.pet_animali;
drop policy if exists "animali_insert" on public.pet_animali;
drop policy if exists "animali_update" on public.pet_animali;
drop policy if exists "animali_delete" on public.pet_animali;
create policy "animali_select" on public.pet_animali for select to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "animali_insert" on public.pet_animali for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "animali_update" on public.pet_animali for update to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));
create policy "animali_delete" on public.pet_animali for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()));
revoke all on public.pet_animali from public, anon;
revoke truncate, references, trigger on public.pet_animali from authenticated;
grant select, insert, update, delete on public.pet_animali to authenticated;

-- 2. Eliminare un animale (la app lo chiama così: il server controlla che sia tuo).
--    Peso e routine di quell'animale spariscono (cascade); scadenze e spese restano senza animale (set null).
create or replace function public.pet_elimina_animale(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.pet_animali where id = p_id and user_id = auth.uid()) then
    raise exception 'Animale non trovato';
  end if;
  delete from public.pet_animali where id = p_id and user_id = auth.uid();
end $$;
revoke all on function public.pet_elimina_animale(uuid) from public, anon;
grant execute on function public.pet_elimina_animale(uuid) to authenticated;

-- Il primo animale dell'utente (il più vecchio): solo per la migrazione qui sotto. Non si chiama dalla app.
create or replace function public.pet_primo_animale(p_user uuid) returns uuid
language sql stable set search_path = public as $$
  select id from public.pet_animali where user_id = p_user order by created_at, id limit 1
$$;
revoke all on function public.pet_primo_animale(uuid) from public, anon, authenticated;

-- 3. pet_registro: animale_id, chiave unica per animale, controlli
alter table public.pet_registro add column if not exists animale_id uuid references public.pet_animali(id) on delete cascade;
drop index if exists public.pet_registro_unico_idx;
-- indice su colonne semplici: l'upsert del client (onConflict) lo richiede
create unique index if not exists pet_registro_unico_idx on public.pet_registro (user_id, tipo, giorno, chiave, animale_id);
create index if not exists pet_registro_animale_idx on public.pet_registro (animale_id);

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
  if new.animale_id is not null and not exists (select 1 from public.pet_animali where id = new.animale_id and user_id = new.user_id) then
    raise exception 'Animale non valido';
  end if;
  if (tg_op = 'INSERT' or new.giorno is distinct from old.giorno)
     and (new.giorno > (now() at time zone 'utc')::date + 1
          or new.giorno < (now() at time zone 'utc')::date - 1827) then
    raise exception 'Giorno fuori dai limiti';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.pet_registro where user_id = new.user_id) >= 5000
     and not exists (select 1 from public.pet_registro where user_id = new.user_id and tipo = new.tipo and giorno = new.giorno and chiave = new.chiave and animale_id is not distinct from new.animale_id) then
    raise exception 'Hai raggiunto il limite di 5000 righe del pet';
  end if;
  return new;
end $$;
revoke all on function public.pet_registro_controlli() from public, anon, authenticated;

-- 4. items e spese: animale_id (facoltativo, dello stesso utente)
create or replace function public.animale_dello_stesso_utente() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.animale_id is not null and not exists (select 1 from public.pet_animali where id = new.animale_id and user_id = new.user_id) then
    raise exception 'Animale non valido';
  end if;
  return new;
end $$;
revoke all on function public.animale_dello_stesso_utente() from public, anon, authenticated;

alter table public.items add column if not exists animale_id uuid references public.pet_animali(id) on delete set null;
create index if not exists items_animale_idx on public.items (animale_id) where animale_id is not null;
drop trigger if exists items_animale_ok on public.items;
create trigger items_animale_ok before insert or update on public.items for each row execute function public.animale_dello_stesso_utente();

alter table public.spese add column if not exists animale_id uuid references public.pet_animali(id) on delete set null;
create index if not exists spese_animale_idx on public.spese (animale_id) where animale_id is not null;
drop trigger if exists spese_animale_ok on public.spese;
create trigger spese_animale_ok before insert or update on public.spese for each row execute function public.animale_dello_stesso_utente();

-- 5. Migrazione dei dati esistenti (ripetibile: lavora solo dove manca ancora qualcosa)
-- 5a. la scheda attuale in user_metadata.pet diventa un animale (se non ce n'è già nessuno)
insert into public.pet_animali (user_id, nome, specie, dt, g, m, a, vet, tel, note, routine)
select u.id,
  left(coalesce(p->>'nome', ''), 20),
  case when coalesce(p->>'specie', '') in ('cane', 'gatto', 'coniglio', 'criceto', 'uccellino', 'pesce', 'rettile', 'altro') then p->>'specie' else '' end,
  case when coalesce(p->>'dt', '') in ('n', 'a') then p->>'dt' else '' end,
  case when (p->>'g') ~ '^[0-9]{1,2}$' and (p->>'g')::int between 1 and 31 then (p->>'g')::int else 0 end,
  case when (p->>'m') ~ '^[0-9]{1,2}$' and (p->>'m')::int between 1 and 12 then (p->>'m')::int else 0 end,
  case when (p->>'a') ~ '^[0-9]{4}$' and (p->>'a')::int between 1980 and 2100 then (p->>'a')::int else 0 end,
  left(coalesce(p->>'vet', ''), 40),
  case when coalesce(p->>'tel', '') ~ '^\+?[0-9 ]{3,20}$' then p->>'tel' else '' end,
  left(coalesce(p->>'note', ''), 300),
  case when jsonb_typeof(p->'routine') = 'array' and jsonb_array_length(p->'routine') <= 8 then p->'routine' else null end
from auth.users u
cross join lateral (select u.raw_user_meta_data->'pet' as p) x
where jsonb_typeof(x.p) = 'object'
  and (coalesce(x.p->>'nome', '') <> '' or coalesce(x.p->>'specie', '') <> '')
  and char_length(coalesce(x.p->>'nome', '')) <= 20
  and not exists (select 1 from public.pet_animali pa where pa.user_id = u.id);

-- 5b. gli "altri animali" della v33 (solo nome) diventano animali, fino a 5 in totale.
--     clock_timestamp: vengono dopo la scheda, così il primo animale resta quello della scheda
insert into public.pet_animali (user_id, nome, created_at)
select u.id, left(trim(alt.nome), 20), clock_timestamp()
from auth.users u
cross join lateral (select u.raw_user_meta_data->'pet' as p) x
cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x.p->'altri') = 'array' then x.p->'altri' else '[]'::jsonb end) with ordinality as alt(nome, ord)
where jsonb_typeof(x.p) = 'object' and trim(alt.nome) <> ''
  and char_length(trim(alt.nome)) <= 20
  and lower(trim(alt.nome)) <> lower(coalesce(x.p->>'nome', ''))
  and not exists (select 1 from public.pet_animali pa where pa.user_id = u.id and lower(pa.nome) = lower(left(trim(alt.nome), 20)))
  and (select count(*) from public.pet_animali pa where pa.user_id = u.id) < 5
  and alt.ord <= 5;

-- 5c. peso e routine senza animale vanno al primo animale
update public.pet_registro r set animale_id = public.pet_primo_animale(r.user_id)
where r.animale_id is null and public.pet_primo_animale(r.user_id) is not null;

-- 5d. scadenze del pet (marcatore U+2063 nel testo): vanno all'animale del tag, altrimenti al primo animale
update public.items i set animale_id = coalesce(
    (select pa.id from public.pet_animali pa
      where pa.user_id = i.user_id and lower(pa.nome) = lower(substring(i.body from chr(8291) || 'pet:[^' || chr(8291) || ']*' || chr(8291) || chr(8291) || 't:([^' || chr(8291) || ']{1,40})' || chr(8291)))
      limit 1),
    public.pet_primo_animale(i.user_id))
where i.animale_id is null and left(i.body, 1) = chr(8291) and i.body like chr(8291) || 'pet:%';

-- 5e. spese del pet (categoria animali): "Nome · nota" va a quell'animale, altrimenti al primo animale
update public.spese s set animale_id = coalesce(
    (select pa.id from public.pet_animali pa
      where pa.user_id = s.user_id and lower(pa.nome) = lower(substring(s.nota from '^(.{1,20}) · '))
      limit 1),
    public.pet_primo_animale(s.user_id))
where s.animale_id is null and s.categoria = 'animali';

-- =========================================================
-- Controlli (solo da leggere). Risultato atteso: 0 in ogni riga.
-- select count(*) from public.pet_registro where animale_id is null;
-- select count(*) from public.items where animale_id is null and left(body, 1) = chr(8291) and body like chr(8291) || 'pet:%';
-- select count(*) from public.spese where animale_id is null and categoria = 'animali';
-- =========================================================
