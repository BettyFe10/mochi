-- =========================================================
-- MOCHI - Liste condivise
-- Una lista (es. "Casa", "Spesa") è condivisa tra più persone: tutto ciò che c'è dentro
-- lo vedono, modificano, spuntano e cancellano tutte le persone della lista.
-- Le voci fuori dalle liste restano private come prima.
-- Ci si unisce a una lista solo con un codice di invito (niente ricerca per email:
-- nessuno può scoprire chi è registrato).
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare senza perdere dati.
-- (È incluso anche in schema.sql, punto 10.)
-- =========================================================

-- 0) COPIA DI SICUREZZA prima di cambiare qualcosa: tutte le voci e le iscrizioni di oggi.
--    Sta in uno schema separato che l'app e internet non possono raggiungere.
--    Per ripristinare una voce persa: chiedi prima (non lanciare comandi a caso sui dati veri).
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.items_prima_delle_liste as select * from public.items;
create table if not exists backup.push_prima_delle_liste as select * from public.push_subscriptions;
revoke all on all tables in schema backup from public, anon, authenticated;

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
