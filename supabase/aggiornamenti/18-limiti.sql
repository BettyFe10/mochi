-- =========================================================
-- MOCHI - Limiti di spazio per account (dall'audit di sicurezza)
-- Limiti generosi: chi usa la app normalmente non li incontra mai. Servono a fermare chi prova a riempire il database.
--   items:        ogni account può occupare al massimo 20 MB tra testi (body) e liste da spuntare (sottotask).
--                 Prima c'era solo il numero di voci (5000): con testi lunghi si arrivava a centinaia di MB a testa.
--                 Il controllo scatta solo quando una voce CRESCE: eliminare, svuotare e accorciare passa sempre,
--                 anche per chi fosse già sopra il tetto. Il limite di 20000 caratteri per voce resta com'era
--                 (in caratteri, non in byte: un testo di 20000 emoji era valido e resta valido).
--   pet_animali:  la routine di un animale pesa al massimo 4000 byte (la app ne usa meno di 600).
--   elimina_il_mio_account(): le voci condivise che passano a chi resta nella lista perdono l'animale
--                 (era di chi se ne va): prima questo bloccava l'eliminazione dell'account.
-- Non serve una versione nuova della app. Non cambia nessun dato esistente.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Prima lanciare 16-animali.sql (se non è già fatto).
-- Tutto o niente: se qualcosa va storto non resta niente a metà (begin ... commit).
-- (È incluso anche in schema.sql, punto 25.)
-- =========================================================

begin;

-- 1. Tetto di spazio per account sulle voci: 20 MB tra body e sottotask.
--    Conta chi è user_id della voce (nelle liste condivise: chi l'ha creata), non chi la sta modificando.
--    security definer: la somma deve vedere tutte le voci dell'account, anche quando scrive un'altra persona della lista.
--    La app salva con upsert (insert ... on conflict do update): se la voce esiste già decide la parte UPDATE,
--    che confronta la dimensione nuova con quella di prima.
create or replace function public.items_spazio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tetto constant bigint := 20000000;
  nuovo bigint := octet_length(coalesce(new.body, '')) + octet_length(coalesce(new.sottotask::text, ''));
  altri bigint;
begin
  if nuovo = 0 then return new; end if;                       -- voce senza testo: non occupa spazio
  if tg_op = 'UPDATE' then
    -- la voce non cresce (uguale, più corta, svuotata): passa sempre, anche sopra il tetto
    if nuovo <= octet_length(coalesce(old.body, '')) + octet_length(coalesce(old.sottotask::text, '')) then return new; end if;
  elsif exists (select 1 from public.items where id = new.id) then
    return new;                                                -- upsert di una voce che esiste già: decide l'UPDATE
  end if;
  select coalesce(sum(octet_length(coalesce(body, '')) + octet_length(coalesce(sottotask::text, ''))), 0) into altri
    from public.items where user_id = new.user_id and id <> new.id;
  if altri + nuovo > tetto then
    raise exception 'Hai raggiunto lo spazio massimo di questo account';
  end if;
  return new;
end $$;
revoke all on function public.items_spazio() from public, anon, authenticated;

-- Il nome conta: i trigger scattano in ordine alfabetico, questo deve venire dopo items_autore (che decide user_id).
-- "update of body, sottotask": non scatta quando si spunta una voce o quando le voci passano a un'altra persona.
drop trigger if exists items_spazio on public.items;
create trigger items_spazio before insert or update of body, sottotask on public.items
  for each row execute function public.items_spazio();

-- 2. Routine dell'animale: al massimo 4000 byte.
--    Vincolo a parte e "not valid": vale subito per ogni scrittura nuova e non può fallire per righe vecchie.
--    Poi si prova a convalidarlo: se una riga vecchia fosse più grande resta "not valid" (e lo script non si ferma).
alter table public.pet_animali drop constraint if exists pet_animali_routine_ok;
alter table public.pet_animali add constraint pet_animali_routine_ok
  check (routine is null or octet_length(routine::text) <= 4000) not valid;
do $$
begin
  alter table public.pet_animali validate constraint pet_animali_routine_ok;
exception when check_violation then
  raise notice 'pet_animali_routine_ok resta "not valid": ci sono routine vecchie oltre i 4000 byte (vedi i controlli in fondo)';
end $$;

-- 3. Eliminazione account: le voci condivise passano a chi resta SENZA animale (l'animale era di chi se ne va
--    e sparisce con l'account; chi eredita non lo possiede e il controllo "Animale non valido" bloccava tutto).
--    Unica differenza dalla versione precedente: ", animale_id = null".
create or replace function public.elimina_il_mio_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); l record; erede uuid;
begin
  if uid is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  for l in select lista_id from public.liste_membri where user_id = uid loop
    select user_id into erede from public.liste_membri where lista_id = l.lista_id and user_id <> uid order by entrata_at limit 1;
    if erede is not null then
      update public.items set user_id = erede, animale_id = null where lista_id = l.lista_id and user_id = uid;
      update public.liste set proprietaria = erede where id = l.lista_id and proprietaria = uid;
    end if;
  end loop;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.elimina_il_mio_account() from public, anon;
grant execute on function public.elimina_il_mio_account() to authenticated;

commit;

-- =========================================================
-- Controlli (solo da leggere, uno alla volta).
-- A) Deve rispondere 1 riga con: trigger = 1, protetta = true, anon = false, collegati = false,
--    vincolo = 1, convalidato = true, account = true
--   select (select count(*) from pg_trigger where tgrelid = 'public.items'::regclass and tgname = 'items_spazio' and not tgisinternal) as trigger,
--          (select prosecdef from pg_proc where oid = 'public.items_spazio()'::regprocedure) as protetta,
--          has_function_privilege('anon', 'public.items_spazio()', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.items_spazio()', 'execute') as collegati,
--          (select count(*) from pg_constraint where conrelid = 'public.pet_animali'::regclass and conname = 'pet_animali_routine_ok') as vincolo,
--          (select convalidated from pg_constraint where conrelid = 'public.pet_animali'::regclass and conname = 'pet_animali_routine_ok') as convalidato,
--          (select prosrc like '%animale_id = null%' from pg_proc where oid = 'public.elimina_il_mio_account()'::regprocedure) as account;
-- B) Account già sopra i 20 MB. Risultato atteso: nessuna riga.
--    (Se ce ne fossero: possono ancora leggere, eliminare e accorciare; non possono aggiungere testo.)
--   select user_id, sum(octet_length(coalesce(body, '')) + octet_length(coalesce(sottotask::text, ''))) as byte
--     from public.items group by user_id
--    having sum(octet_length(coalesce(body, '')) + octet_length(coalesce(sottotask::text, ''))) > 20000000;
-- C) Routine vecchie oltre i 4000 byte. Risultato atteso: 0.
--    (Se fosse più di 0, "convalidato" qui sopra è false: quelle schede non si salvano finché la routine non viene accorciata.)
--   select count(*) from public.pet_animali where routine is not null and octet_length(routine::text) > 4000;
-- =========================================================
