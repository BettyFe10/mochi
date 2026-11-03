-- =========================================================
-- MOCHI - "Consiglia alla sviluppatrice"
-- Gli utenti mandano idee, problemi o complimenti. Li legge solo chi gestisce il progetto Supabase.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare senza perdere dati.
-- (È incluso anche in schema.sql, punto 9.)
-- =========================================================
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

create or replace function public.leggi_consigli() returns table (
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
