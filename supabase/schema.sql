-- =========================================================
-- MOCHI - schema del database Supabase (multi-utente, rinforzato)
-- Incolla tutto in Supabase > SQL Editor > New query > Run
-- Si può rilanciare senza perdere dati.
-- =========================================================

-- 1) Le voci: cose da fare, appuntamenti, appunti
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text default '',
  area        text not null default 'personale',
  due_date    date,
  due_time    text,
  remind      text default 'none',
  remind_at   timestamptz,
  reminded    boolean not null default false,
  done        boolean not null default false,
  done_at     timestamptz,
  color       int default 1,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_user_idx   on public.items (user_id);
create index if not exists items_remind_idx on public.items (remind_at) where reminded = false;

-- Validazione dei campi: niente testi giganti, niente HTML nei campi tecnici
alter table public.items drop constraint if exists items_kind_ok;
alter table public.items add  constraint items_kind_ok   check (kind in ('todo','event','note'));
alter table public.items drop constraint if exists items_area_ok;
alter table public.items add  constraint items_area_ok   check (area in ('personale','lavoro'));
alter table public.items drop constraint if exists items_title_ok;
alter table public.items add  constraint items_title_ok  check (char_length(title) between 1 and 300);
alter table public.items drop constraint if exists items_body_ok;
alter table public.items add  constraint items_body_ok   check (body is null or char_length(body) <= 20000);
alter table public.items drop constraint if exists items_time_ok;
alter table public.items add  constraint items_time_ok   check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.items drop constraint if exists items_remind_ok;
alter table public.items add  constraint items_remind_ok check (remind is null or remind in ('none','auto','0','10','30','60','1440','morning'));
alter table public.items drop constraint if exists items_color_ok;
alter table public.items add  constraint items_color_ok  check (color is null or color between 1 and 12);
alter table public.items drop constraint if exists items_date_ok;
alter table public.items add  constraint items_date_ok   check (due_date is null or due_date between date '2000-01-01' and date '2100-12-31');

-- 2) Iscrizioni alle notifiche (una per ogni dispositivo)
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
-- Solo indirizzi dei servizi push veri (Apple, Google, Mozilla, Microsoft): impedisce di usare
-- la funzione dei promemoria per mandare richieste verso server arbitrari
alter table public.push_subscriptions drop constraint if exists push_endpoint_ok;
alter table public.push_subscriptions add  constraint push_endpoint_ok check (
  char_length(endpoint) <= 1000 and
  endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
);
alter table public.push_subscriptions drop constraint if exists push_keys_ok;
alter table public.push_subscriptions add  constraint push_keys_ok check (char_length(p256dh) <= 200 and char_length(auth) <= 100);

-- 3) Limiti per utente (anti-spam): max 5.000 voci e 10 dispositivi
create or replace function public.limite_per_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'items' and (select count(*) from public.items where user_id = new.user_id) >= 5000 then
    raise exception 'Hai raggiunto il limite di 5000 voci';
  end if;
  if tg_table_name = 'push_subscriptions' and (select count(*) from public.push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'Troppi dispositivi collegati';
  end if;
  return new;
end $$;
drop trigger if exists items_limite on public.items;
create trigger items_limite before insert on public.items for each row execute function public.limite_per_utente();
drop trigger if exists push_limite on public.push_subscriptions;
create trigger push_limite before insert on public.push_subscriptions for each row execute function public.limite_per_utente();

-- 3b) Dati accettati solo dal TUO sito (e dall'app nativa).
-- Una copia della web app pubblicata altrove con le tue chiavi viene rifiutata dal database.
-- Finché la tabella è vuota la protezione è spenta: si attiva aggiungendo il tuo dominio (vedi README).
create table if not exists public.origini_consentite (origine text primary key);
alter table public.origini_consentite enable row level security;
revoke all on public.origini_consentite from anon, authenticated;

create or replace function public.origine_consentita() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare o text;
begin
  if not exists (select 1 from public.origini_consentite) then return true; end if;
  o := lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'origin', ''));
  -- Nessuna intestazione Origin: app nativa iPhone/Mac (non è un browser) o aggiornamenti in tempo reale
  if o = '' then return true; end if;
  return exists (select 1 from public.origini_consentite where lower(origine) = o);
end $$;
revoke all on function public.origine_consentita() from public;
grant execute on function public.origine_consentita() to anon, authenticated;

-- 4) Row Level Security: ogni riga è visibile e modificabile SOLO dal suo proprietario
alter table public.items enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "solo_proprietaria_items" on public.items;
create policy "solo_proprietaria_items" on public.items
  for all to authenticated
  using (user_id = auth.uid() and public.origine_consentita())
  with check (user_id = auth.uid() and public.origine_consentita());

drop policy if exists "solo_proprietaria_push" on public.push_subscriptions;
create policy "solo_proprietaria_push" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid() and public.origine_consentita())
  with check (user_id = auth.uid() and public.origine_consentita());

-- Chi non ha fatto login non ha alcun permesso
revoke all on public.items from anon;
revoke all on public.push_subscriptions from anon;
-- Permessi espliciti per gli utenti loggati: alcuni progetti Supabase non li concedono in automatico
-- (le tabelle risultano "API DISABLED"). Cosa vede ciascuno lo decide comunque la Row Level Security qui sopra.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, delete on public.push_subscriptions to authenticated;
-- I dispositivi si registrano solo tramite la funzione registra_dispositivo (punto 5)
revoke insert, update on public.push_subscriptions from authenticated;
-- Nessun permesso oltre a quelli che servono: TRUNCATE in particolare ignora la Row Level Security
revoke truncate, references, trigger on public.items, public.push_subscriptions, public.origini_consentite from anon, authenticated;

-- 5) Registrazione di un dispositivo per le notifiche.
-- Se il dispositivo era collegato a un altro account (telefono passato di mano, logout mancato),
-- passa al nuovo proprietario: chi ha il dispositivo in mano è chi deve ricevere le notifiche.
create or replace function public.registra_dispositivo(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth);
end $$;
revoke all on function public.registra_dispositivo(text, text, text) from public, anon;
grant execute on function public.registra_dispositivo(text, text, text) to authenticated;

-- 6) Eliminazione del proprio account (diritto alla cancellazione, GDPR).
-- Cancella l'utente; voci e dispositivi spariscono a cascata.
create or replace function public.elimina_il_mio_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.elimina_il_mio_account() from public, anon;
grant execute on function public.elimina_il_mio_account() to authenticated;

-- 7) Coda dei promemoria equa: al massimo 20 per utente per giro, così nessuno può intasare quella degli altri.
-- I promemoria scaduti da più di 2 ore vengono archiviati senza invio.
create or replace function public.promemoria_da_inviare() returns table (id uuid, user_id uuid, kind text, title text, due_time text)
language plpgsql security definer set search_path = public as $$
begin
  update public.items i set reminded = true
   where i.reminded = false and i.remind_at < now() - interval '2 hours';
  return query
    select x.id, x.user_id, x.kind, x.title, x.due_time from (
      select i.*, row_number() over (partition by i.user_id order by i.remind_at) rn
        from public.items i
       where i.reminded = false and i.done = false and i.remind_at is not null and i.remind_at <= now()
    ) x where x.rn <= 20
    limit 1000;
end $$;
revoke all on function public.promemoria_da_inviare() from public, anon, authenticated;
grant execute on function public.promemoria_da_inviare() to service_role;

-- 8) Sincronizzazione in tempo reale (rispetta la Row Level Security)
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;

-- 9) "Consiglia alla sviluppatrice": messaggi degli utenti, leggibili solo da chi gestisce il progetto
create table if not exists public.consigli (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null default 'idea',
  testo       text not null,
  dispositivo text,
  letto       boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists consigli_user_idx on public.consigli (user_id, created_at);
alter table public.consigli drop constraint if exists consigli_tipo_ok;
alter table public.consigli add  constraint consigli_tipo_ok check (tipo in ('idea','problema','complimento'));
alter table public.consigli drop constraint if exists consigli_testo_ok;
alter table public.consigli add  constraint consigli_testo_ok check (char_length(btrim(testo)) between 3 and 2000);
alter table public.consigli drop constraint if exists consigli_disp_ok;
alter table public.consigli add  constraint consigli_disp_ok check (dispositivo is null or dispositivo in ('iPhone','iPad','Mac','Android','Windows','Altro'));

-- Nessuno legge o scrive la tabella direttamente: solo la funzione qui sotto può aggiungere righe.
-- La leggi tu dal pannello di Supabase (Table Editor > consigli), che non passa da questi permessi.
alter table public.consigli enable row level security;
revoke all on public.consigli from anon, authenticated;

create or replace function public.invia_consiglio(p_tipo text, p_testo text, p_dispositivo text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  -- anti-spam: al massimo 5 messaggi al giorno e 200 in tutto per persona
  if (select count(*) from public.consigli where user_id = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Hai già mandato 5 messaggi oggi, grazie! Riprova domani';
  end if;
  if (select count(*) from public.consigli where user_id = uid) >= 200 then
    raise exception 'Hai raggiunto il limite di messaggi';
  end if;
  insert into public.consigli (user_id, tipo, testo, dispositivo) values (uid, p_tipo, btrim(p_testo), p_dispositivo);
end $$;
revoke all on function public.invia_consiglio(text, text, text) from public, anon;
grant execute on function public.invia_consiglio(text, text, text) to authenticated;

-- ---------- Lettura dei messaggi dall'app, solo per chi gestisce Mochi ----------
-- Chi è amministratrice lo decide SOLO questa tabella, che si modifica soltanto dal pannello di Supabase.
create table if not exists public.amministratrici (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.amministratrici enable row level security;
revoke all on public.amministratrici from anon, authenticated;

create or replace function public.sono_amministratrice() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.origine_consentita()
     and exists (select 1 from public.amministratrici where user_id = auth.uid());
$$;
revoke all on function public.sono_amministratrice() from public, anon;
grant execute on function public.sono_amministratrice() to authenticated;

drop function if exists public.leggi_consigli();
create function public.leggi_consigli() returns table (
  id uuid, created_at timestamptz, nome text, email text, tipo text, dispositivo text, testo text, letto boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.sono_amministratrice() then raise exception 'Non autorizzato'; end if;
  return query
    select c.id, c.created_at, coalesce(u.raw_user_meta_data->>'nome', '')::text, u.email::text, c.tipo, c.dispositivo, c.testo, c.letto
      from public.consigli c join auth.users u on u.id = c.user_id
     order by c.created_at desc
     limit 300;
end $$;
revoke all on function public.leggi_consigli() from public, anon;
grant execute on function public.leggi_consigli() to authenticated;

create or replace function public.segna_consiglio(p_id uuid, p_letto boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sono_amministratrice() then raise exception 'Non autorizzato'; end if;
  update public.consigli set letto = p_letto where id = p_id;
end $$;
revoke all on function public.segna_consiglio(uuid, boolean) from public, anon;
grant execute on function public.segna_consiglio(uuid, boolean) to authenticated;

-- Per diventare amministratrice (una volta sola, metti la TUA email):
--   insert into public.amministratrici (user_id) select id from auth.users where email = 'LA-TUA-EMAIL' on conflict do nothing;

-- Per leggerli con nome ed email di chi scrive (da lanciare nel SQL Editor):
--   select c.created_at, u.raw_user_meta_data->>'nome' as nome, u.email, c.tipo, c.dispositivo, c.testo
--   from public.consigli c join auth.users u on u.id = c.user_id
--   order by c.created_at desc;
-- Per segnarli come letti:   update public.consigli set letto = true where letto = false;

-- 10) Liste condivise (sostituisce la regola delle voci del punto 4)

-- 1) Liste e persone che ne fanno parte
create table if not exists public.liste (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  emoji          text not null default '🏠',
  proprietaria   uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now()
);
alter table public.liste drop constraint if exists liste_nome_ok;
alter table public.liste add  constraint liste_nome_ok  check (char_length(btrim(nome)) between 1 and 40);
alter table public.liste drop constraint if exists liste_emoji_ok;
alter table public.liste add  constraint liste_emoji_ok check (char_length(emoji) between 1 and 8 and emoji !~ '[<>"''&A-Za-z0-9]');

create table if not exists public.liste_membri (
  lista_id   uuid not null references public.liste(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  entrata_at timestamptz not null default now(),
  primary key (lista_id, user_id)
);
create index if not exists liste_membri_user_idx on public.liste_membri (user_id);

-- 2) Inviti: codice da mandare (es. su WhatsApp), vale 7 giorni e una sola volta
create table if not exists public.inviti (
  codice     text primary key,
  lista_id   uuid not null references public.liste(id) on delete cascade,
  creato_da  uuid not null references auth.users(id) on delete cascade,
  scade_at   timestamptz not null default now() + interval '7 days',
  usato_da   uuid references auth.users(id) on delete set null
);
-- Tentativi con codici sbagliati: oltre 20 in un'ora si viene fermati (contro chi prova a indovinarli)
create table if not exists public.inviti_tentativi (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists inviti_tentativi_idx on public.inviti_tentativi (user_id, at);

-- 3) Le voci possono stare in una lista; si ricorda chi le ha spuntate
alter table public.items add column if not exists lista_id uuid references public.liste(id) on delete cascade;
alter table public.items add column if not exists done_by  uuid references auth.users(id) on delete set null;
create index if not exists items_lista_idx on public.items (lista_id) where lista_id is not null;

-- 4) Notifiche di attività ("Giulia ha aggiunto...", "Giulia ha fatto...") in attesa di invio
create table if not exists public.notifiche_coda (
  id           bigint generated always as identity primary key,
  destinatario uuid not null references auth.users(id) on delete cascade,
  titolo       text not null,
  corpo        text not null,
  item_id      uuid,
  created_at   timestamptz not null default now()
);
create index if not exists notifiche_coda_dest_idx on public.notifiche_coda (destinatario, created_at);

-- Nessuno tocca queste tabelle direttamente: solo tramite le funzioni qui sotto
alter table public.liste enable row level security;
alter table public.liste_membri enable row level security;
alter table public.inviti enable row level security;
alter table public.inviti_tentativi enable row level security;
alter table public.notifiche_coda enable row level security;
revoke all on public.liste, public.liste_membri, public.inviti, public.inviti_tentativi, public.notifiche_coda from anon, authenticated;

-- 5) Sono nella lista?
create or replace function public.sono_membro(p_lista uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.liste_membri where lista_id = p_lista and user_id = auth.uid());
$$;
revoke all on function public.sono_membro(uuid) from public;
grant execute on function public.sono_membro(uuid) to authenticated;

-- 6) Nuove regole per le voci: le mie private + quelle delle liste di cui faccio parte
drop policy if exists "solo_proprietaria_items" on public.items;
drop policy if exists "voci_mie_o_condivise" on public.items;
create policy "voci_mie_o_condivise" on public.items
  for all to authenticated
  using (public.origine_consentita() and (
    (lista_id is null and user_id = auth.uid()) or (lista_id is not null and public.sono_membro(lista_id))))
  with check (public.origine_consentita() and (
    (lista_id is null and user_id = auth.uid()) or (lista_id is not null and public.sono_membro(lista_id))));

-- Chi crea una voce è sempre chi è collegato, e non si può cambiare dopo.
-- Chi la spunta viene registrato (serve per i bocconcini e per "Giulia ha fatto...").
create or replace function public.voci_autore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.done_by := case when new.done then coalesce(auth.uid(), new.user_id) else null end;
  else
    new.user_id := old.user_id;
    if new.done and not old.done then new.done_by := coalesce(auth.uid(), new.user_id);
    elsif not new.done then new.done_by := null;
    else new.done_by := old.done_by; end if;
  end if;
  return new;
end $$;
drop trigger if exists items_autore on public.items;
create trigger items_autore before insert or update on public.items for each row execute function public.voci_autore();

-- 7) Notifiche di attività per le altre persone della lista
create or replace function public.voci_attivita() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare chi text; lst record; azione text;
begin
  if new.lista_id is null or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then azione := 'ha aggiunto';
  elsif new.done and not old.done then azione := 'ha fatto';
  else return new; end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'nome'), ''), 'Qualcuno') into chi from auth.users where id = auth.uid();
  select nome, emoji into lst from public.liste where id = new.lista_id;
  insert into public.notifiche_coda (destinatario, titolo, corpo, item_id)
    select m.user_id, left(chi, 40) || ' ' || azione, lst.emoji || ' ' || lst.nome || ': ' || left(new.title, 120), new.id
      from public.liste_membri m
     where m.lista_id = new.lista_id and m.user_id <> auth.uid()
       -- anti-valanga: se ce ne sono già 100 in attesa per quella persona, non ne aggiungo altre
       and (select count(*) from public.notifiche_coda q where q.destinatario = m.user_id) < 100;
  return new;
end $$;
drop trigger if exists items_attivita on public.items;
create trigger items_attivita after insert or update of done on public.items for each row execute function public.voci_attivita();

-- 8) Funzioni per l'app
create or replace function public.le_mie_liste() returns table (id uuid, nome text, emoji text, proprietaria uuid, membri jsonb)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  return query
    select l.id, l.nome, l.emoji, l.proprietaria,
           (select coalesce(jsonb_agg(jsonb_build_object('user_id', m2.user_id,
                    'nome', coalesce(nullif(btrim(u.raw_user_meta_data->>'nome'), ''), 'Senza nome')) order by m2.entrata_at), '[]'::jsonb)
              from public.liste_membri m2 join auth.users u on u.id = m2.user_id where m2.lista_id = l.id)
      from public.liste l join public.liste_membri m on m.lista_id = l.id and m.user_id = auth.uid()
     order by l.created_at;
end $$;

create or replace function public.crea_lista(p_nome text, p_emoji text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if auth.uid() is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  if (select count(*) from public.liste_membri where user_id = auth.uid()) >= 20 then raise exception 'Puoi avere al massimo 20 liste'; end if;
  insert into public.liste (nome, emoji, proprietaria) values (btrim(p_nome), coalesce(nullif(btrim(p_emoji), ''), '🏠'), auth.uid()) returning id into nid;
  insert into public.liste_membri (lista_id, user_id) values (nid, auth.uid());
  return nid;
end $$;

create or replace function public.modifica_lista(p_lista uuid, p_nome text, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.origine_consentita() or not public.sono_membro(p_lista) then raise exception 'Non autorizzato'; end if;
  update public.liste set nome = btrim(p_nome), emoji = coalesce(nullif(btrim(p_emoji), ''), emoji) where id = p_lista;
end $$;

create or replace function public.crea_invito(p_lista uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.origine_consentita() or not public.sono_membro(p_lista) then raise exception 'Non autorizzato'; end if;
  if (select count(*) from public.liste_membri where lista_id = p_lista) >= 10 then raise exception 'La lista ha già 10 persone'; end if;
  delete from public.inviti where scade_at < now() or usato_da is not null;
  if (select count(*) from public.inviti where lista_id = p_lista) >= 10 then raise exception 'Troppi inviti in sospeso per questa lista'; end if;
  -- 16 caratteri casuali (64 bit): impossibili da indovinare
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.inviti (codice, lista_id, creato_da) values (c, p_lista, auth.uid());
  return c;
end $$;

-- Controllo del codice, con freno contro chi prova a indovinarlo.
-- Un codice sbagliato NON genera errore (un errore annullerebbe anche il conteggio del tentativo):
-- restituisce una riga vuota e l'app mostra "invito non valido".
create or replace function public.controlla_invito(p_codice text) returns public.inviti
language plpgsql security definer set search_path = public as $$
declare inv public.inviti;
begin
  if auth.uid() is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  if (select count(*) from public.inviti_tentativi where user_id = auth.uid() and at > now() - interval '1 hour') >= 20 then
    raise exception 'Troppi tentativi, riprova tra un''ora';
  end if;
  select * into inv from public.inviti where codice = upper(btrim(coalesce(p_codice, ''))) and scade_at > now() and usato_da is null;
  if inv.codice is null then
    insert into public.inviti_tentativi (user_id) values (auth.uid());
    delete from public.inviti_tentativi where at < now() - interval '1 day';
  end if;
  return inv;
end $$;
revoke all on function public.controlla_invito(text) from public, anon, authenticated;

create or replace function public.anteprima_invito(p_codice text) returns table (nome text, emoji text, da_chi text, gia_dentro boolean)
language plpgsql security definer set search_path = public, auth as $$
declare inv public.inviti;
begin
  inv := public.controlla_invito(p_codice);
  if inv.codice is null then return; end if;  -- nessuna riga = invito non valido
  return query
    select l.nome, l.emoji, coalesce(nullif(btrim(u.raw_user_meta_data->>'nome'), ''), 'Qualcuno'), public.sono_membro(l.id)
      from public.liste l join auth.users u on u.id = inv.creato_da where l.id = inv.lista_id;
end $$;

create or replace function public.accetta_invito(p_codice text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.inviti;
begin
  inv := public.controlla_invito(p_codice);
  if inv.codice is null then return null; end if;  -- null = invito non valido
  if public.sono_membro(inv.lista_id) then return inv.lista_id; end if;
  if (select count(*) from public.liste_membri where lista_id = inv.lista_id) >= 10 then raise exception 'La lista ha già 10 persone'; end if;
  if (select count(*) from public.liste_membri where user_id = auth.uid()) >= 20 then raise exception 'Puoi avere al massimo 20 liste'; end if;
  update public.inviti set usato_da = auth.uid() where codice = inv.codice and usato_da is null;
  if not found then raise exception 'Invito non valido o scaduto'; end if;
  insert into public.liste_membri (lista_id, user_id) values (inv.lista_id, auth.uid());
  return inv.lista_id;
end $$;

-- Uscire: le voci restano a chi rimane. L'ultima persona che esce cancella la lista e le sue voci.
create or replace function public.esci_dalla_lista(p_lista uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.origine_consentita() or not public.sono_membro(p_lista) then raise exception 'Non autorizzato'; end if;
  delete from public.liste_membri where lista_id = p_lista and user_id = auth.uid();
  if not exists (select 1 from public.liste_membri where lista_id = p_lista) then
    delete from public.liste where id = p_lista;
  else
    update public.liste set proprietaria = (select user_id from public.liste_membri where lista_id = p_lista order by entrata_at limit 1)
     where id = p_lista and proprietaria = auth.uid();
  end if;
end $$;

-- Eliminare la lista per tutte (con le sue voci): solo chi la gestisce
create or replace function public.elimina_lista(p_lista uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.origine_consentita() or not exists (select 1 from public.liste where id = p_lista and proprietaria = auth.uid()) then
    raise exception 'Solo chi gestisce la lista può eliminarla';
  end if;
  delete from public.liste where id = p_lista;
end $$;

revoke all on function public.le_mie_liste(), public.crea_lista(text, text), public.modifica_lista(uuid, text, text),
  public.crea_invito(uuid), public.anteprima_invito(text), public.accetta_invito(text),
  public.esci_dalla_lista(uuid), public.elimina_lista(uuid) from public, anon;
grant execute on function public.le_mie_liste(), public.crea_lista(text, text), public.modifica_lista(uuid, text, text),
  public.crea_invito(uuid), public.anteprima_invito(text), public.accetta_invito(text),
  public.esci_dalla_lista(uuid), public.elimina_lista(uuid) to authenticated;

-- 9) Per il server: promemoria con tutte le persone da avvisare, e notifiche di attività
create or replace function public.promemoria_da_inviare_v2() returns table (id uuid, user_id uuid, kind text, title text, due_time text, destinatari uuid[])
language plpgsql security definer set search_path = public as $$
begin
  update public.items i set reminded = true
   where i.reminded = false and i.remind_at < now() - interval '2 hours';
  return query
    select x.id, x.user_id, x.kind, x.title, x.due_time,
           case when x.lista_id is null then array[x.user_id]
                else coalesce((select array_agg(m.user_id) from public.liste_membri m where m.lista_id = x.lista_id), array[x.user_id]) end
      from (
        select i.*, row_number() over (partition by coalesce(i.lista_id, i.user_id) order by i.remind_at) rn
          from public.items i
         where i.reminded = false and i.done = false and i.remind_at is not null and i.remind_at <= now()
      ) x where x.rn <= 20
     limit 1000;
end $$;
revoke all on function public.promemoria_da_inviare_v2() from public, anon, authenticated;
grant execute on function public.promemoria_da_inviare_v2() to service_role;

-- Prende (e toglie dalla coda) al massimo 20 notifiche per persona per giro; quelle vecchie di un giorno si scartano
create or replace function public.notifiche_da_inviare() returns table (destinatario uuid, titolo text, corpo text, item_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifiche_coda where created_at < now() - interval '1 day';
  return query
    with scelte as (
      select q.id from (
        select n.id, row_number() over (partition by n.destinatario order by n.created_at) rn from public.notifiche_coda n
      ) q where q.rn <= 20
    )
    delete from public.notifiche_coda n using scelte s where n.id = s.id
    returning n.destinatario, n.titolo, n.corpo, n.item_id;
end $$;
revoke all on function public.notifiche_da_inviare() from public, anon, authenticated;
grant execute on function public.notifiche_da_inviare() to service_role;

-- 10) Nessun permesso superfluo sulle nuove tabelle
revoke truncate, references, trigger on public.liste, public.liste_membri, public.inviti, public.inviti_tentativi, public.notifiche_coda from anon, authenticated;

-- 11) Eliminazione account con liste condivise: le liste e le voci condivise restano a chi rimane
create or replace function public.voci_autore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.done_by := case when new.done then coalesce(auth.uid(), new.user_id) else null end;
  else
    -- L'autore non si cambia. Unica eccezione: chi ha creato una voce condivisa può passarla a un'altra
    -- persona della stessa lista (serve quando elimina l'account, così le voci restano a chi rimane).
    if not (new.user_id is distinct from old.user_id and auth.uid() = old.user_id and new.lista_id is not null
            and exists (select 1 from public.liste_membri m where m.lista_id = new.lista_id and m.user_id = new.user_id)) then
      new.user_id := old.user_id;
    end if;
    if new.done and not old.done then new.done_by := coalesce(auth.uid(), new.user_id);
    elsif not new.done then new.done_by := null;
    else new.done_by := old.done_by; end if;
  end if;
  return new;
end $$;

create or replace function public.elimina_il_mio_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); l record; erede uuid;
begin
  if uid is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  for l in select lista_id from public.liste_membri where user_id = uid loop
    select user_id into erede from public.liste_membri where lista_id = l.lista_id and user_id <> uid order by entrata_at limit 1;
    if erede is not null then
      update public.items set user_id = erede where lista_id = l.lista_id and user_id = uid;
      update public.liste set proprietaria = erede where id = l.lista_id and proprietaria = uid;
    end if;
  end loop;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.elimina_il_mio_account() from public, anon;
grant execute on function public.elimina_il_mio_account() to authenticated;

-- 12) Permessi al minimo indispensabile
-- Funzioni che scattano da sole quando si salva una voce: nessuno deve poterle chiamare direttamente
revoke all on function public.voci_autore(), public.voci_attivita(), public.limite_per_utente() from public, anon, authenticated;
-- Controlli usati dalle regole di accesso: servono solo a chi ha fatto login
revoke all on function public.sono_membro(uuid), public.origine_consentita() from public, anon;
grant execute on function public.sono_membro(uuid), public.origine_consentita() to authenticated;

-- 13) Promemoria ricorrenti

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

-- 14) Ottimizzazioni (regole più leggere, indici, controllo veloce per il cron; il cron è in cron.sql)
-- 1) Regole di accesso: "(select ...)" fa calcolare utente e sito una volta sola per richiesta
drop policy if exists "voci_mie_o_condivise" on public.items;
create policy "voci_mie_o_condivise" on public.items
  for all to authenticated
  using ((select public.origine_consentita()) and (
    (lista_id is null and user_id = (select auth.uid())) or (lista_id is not null and public.sono_membro(lista_id))))
  with check ((select public.origine_consentita()) and (
    (lista_id is null and user_id = (select auth.uid())) or (lista_id is not null and public.sono_membro(lista_id))));

drop policy if exists "solo_proprietaria_push" on public.push_subscriptions;
create policy "solo_proprietaria_push" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));

drop policy if exists "solo_mie_ricorrenti" on public.ricorrenti;
create policy "solo_mie_ricorrenti" on public.ricorrenti
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.origine_consentita()))
  with check (user_id = (select auth.uid()) and (select public.origine_consentita()));

-- Indici per i controlli più frequenti
create index if not exists items_dovuti_idx on public.items (remind_at) where reminded = false and done = false;
create index if not exists notifiche_coda_created_idx on public.notifiche_coda (created_at);

-- 2) C'è qualcosa da mandare adesso? (domanda velocissima, usata dal controllo di ogni minuto)
create or replace function public.ci_sono_invii() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.items where reminded = false and done = false and remind_at is not null and remind_at <= now())
      or exists (select 1 from public.notifiche_coda)
      or exists (select 1 from public.ricorrenti where attiva and prossimo_invio is not null and prossimo_invio <= now());
$$;
revoke all on function public.ci_sono_invii() from public, anon, authenticated;

-- 15) Com'è andata la giornata
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

-- 16) Ordine dei post-it (trascinamento)
alter table public.items add column if not exists posizione double precision;
alter table public.items drop constraint if exists items_posizione_ok;
alter table public.items add constraint items_posizione_ok check (
  posizione is null or (posizione > -1e15 and posizione < 1e15)
);

-- 17) Turni di lavoro
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

-- 18) Rispondere ai messaggi di Consiglia
alter table public.consigli add column if not exists stato text not null default 'ricevuto';
alter table public.consigli add column if not exists risposta text;
alter table public.consigli add column if not exists risposta_at timestamptz;
alter table public.consigli add column if not exists risposta_vista boolean not null default true;
alter table public.consigli drop constraint if exists consigli_stato_ok;
alter table public.consigli add constraint consigli_stato_ok check (
  stato in ('ricevuto', 'in_corso', 'fatto', 'no')
  and (risposta is null or char_length(risposta) between 1 and 500)
);

-- La lettura per chi gestisce Mochi ora include stato e commento (cambia il formato: va ricreata)
drop function if exists public.leggi_consigli();
create function public.leggi_consigli() returns table (
  id uuid, created_at timestamptz, nome text, email text, tipo text, dispositivo text, testo text, letto boolean, stato text, risposta text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.sono_amministratrice() then raise exception 'Non autorizzato'; end if;
  return query
    select c.id, c.created_at, coalesce(u.raw_user_meta_data->>'nome', '')::text, u.email::text, c.tipo, c.dispositivo, c.testo, c.letto, c.stato, c.risposta
      from public.consigli c join auth.users u on u.id = c.user_id
     order by c.created_at desc
     limit 300;
end $$;
revoke all on function public.leggi_consigli() from public, anon;
grant execute on function public.leggi_consigli() to authenticated;

-- Rispondere: solo chi gestisce Mochi. Avvisa chi ha scritto con una notifica.
create or replace function public.rispondi_consiglio(p_id uuid, p_stato text, p_risposta text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; r text := nullif(btrim(coalesce(p_risposta, '')), '');
begin
  if not public.sono_amministratrice() then raise exception 'Non autorizzato'; end if;
  if p_stato not in ('ricevuto', 'in_corso', 'fatto', 'no') then raise exception 'Stato non valido'; end if;
  if r is not null and char_length(r) > 500 then raise exception 'Commento troppo lungo'; end if;
  select * into c from public.consigli where id = p_id;
  if c.id is null then raise exception 'Messaggio non trovato'; end if;
  update public.consigli
     set stato = p_stato, risposta = r, letto = true,
         risposta_at = case when c.stato is distinct from p_stato or c.risposta is distinct from r then now() else risposta_at end,
         risposta_vista = case when c.stato is distinct from p_stato or c.risposta is distinct from r then false else risposta_vista end
   where id = p_id;
  -- notifica solo se è cambiato qualcosa, e mai più di 100 in attesa per persona
  if (c.stato is distinct from p_stato or c.risposta is distinct from r)
     and (select count(*) from public.notifiche_coda q where q.destinatario = c.user_id) < 100 then
    insert into public.notifiche_coda (destinatario, titolo, corpo)
    values (c.user_id,
      case p_stato when 'fatto' then 'Il tuo messaggio: fatto ✅' when 'in_corso' then 'Il tuo messaggio: ci sto lavorando 🛠️'
                   when 'no' then 'Il tuo messaggio ha una risposta' else 'Il tuo messaggio è stato letto 💌' end,
      coalesce(left(r, 140), left(c.testo, 80)));
  end if;
end $$;
revoke all on function public.rispondi_consiglio(uuid, text, text) from public, anon;
grant execute on function public.rispondi_consiglio(uuid, text, text) to authenticated;

-- Chi ha scritto vede SOLO i propri messaggi, con stato e commento
create or replace function public.miei_consigli() returns table (
  id uuid, created_at timestamptz, tipo text, testo text, stato text, risposta text, risposta_at timestamptz, risposta_vista boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  return query
    select c.id, c.created_at, c.tipo, c.testo, c.stato, c.risposta, c.risposta_at, c.risposta_vista
      from public.consigli c where c.user_id = auth.uid()
     order by c.created_at desc limit 50;
end $$;
revoke all on function public.miei_consigli() from public, anon;
grant execute on function public.miei_consigli() to authenticated;

create or replace function public.risposte_viste() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.origine_consentita() then raise exception 'Non autorizzato'; end if;
  update public.consigli set risposta_vista = true where user_id = auth.uid() and not risposta_vista;
end $$;
revoke all on function public.risposte_viste() from public, anon;
grant execute on function public.risposte_viste() to authenticated;

-- 19) Liste da spuntare dentro le voci (sottotask)
-- Controllo del formato: lista vera, al massimo 50 righe, ogni riga con esattamente id, t e f giusti
create or replace function public.sottotask_ok(s jsonb) returns boolean
language sql immutable parallel safe set search_path = public as $$
  select case
    when s is null then true
    when jsonb_typeof(s) <> 'array' then false
    when jsonb_array_length(s) > 50 or octet_length(s::text) > 32000 then false
    else not exists (
      select 1 from jsonb_array_elements(s) as e(v)
       where case
         when jsonb_typeof(v) <> 'object' then true
         else not coalesce(
           (select count(*) from jsonb_object_keys(v)) = 3
           and jsonb_typeof(v -> 'id') = 'string' and (v ->> 'id') ~ '^[A-Za-z0-9-]{1,40}$'
           and jsonb_typeof(v -> 't') = 'string' and char_length(v ->> 't') between 1 and 120
           and jsonb_typeof(v -> 'f') = 'boolean', false)
       end)
  end
$$;
-- La usa solo il database per controllare le voci: serve a chi salva (utenti collegati e server dei promemoria)
revoke all on function public.sottotask_ok(jsonb) from public, anon;
grant execute on function public.sottotask_ok(jsonb) to authenticated, service_role;

alter table public.items add column if not exists sottotask jsonb;
alter table public.items drop constraint if exists items_sottotask_ok;
alter table public.items add constraint items_sottotask_ok check (public.sottotask_ok(sottotask));

-- Controllo: deve rispondere 1
--   select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'sottotask';

-- 20) Spese (budget tracker)
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

-- 21) Giorni attivi (Serie di giorni): le date in cui hai spuntato almeno una cosa.
-- Solo tue, una riga per giorno, niente giorni nel futuro. Stesso contenuto di aggiornamenti/13-giorni-attivi.sql
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
