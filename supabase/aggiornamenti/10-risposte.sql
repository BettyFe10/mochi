-- =========================================================
-- MOCHI - Rispondere ai messaggi di "Consiglia" dentro l'app
-- Chi gestisce Mochi può dare a ogni messaggio uno stato (Ricevuto, Ci sto lavorando, Fatto, Non per ora)
-- e un breve commento. Chi ha scritto lo vede nell'app e riceve una notifica. Niente email.
-- Non cancella e non modifica i messaggi esistenti (diventano tutti "Ricevuto"). Si può rilanciare.
-- (È incluso anche in schema.sql, punto 18.)
-- =========================================================
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

-- Controllo: deve rispondere 4
--   select count(*) from information_schema.columns where table_name = 'consigli' and column_name in ('stato','risposta','risposta_at','risposta_vista');
