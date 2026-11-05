-- =========================================================
-- MOCHI - Liste da spuntare dentro le voci (sottotask)
-- Aggiunge alle voci (tabella items) la colonna "sottotask": al massimo 50 righe da spuntare, ognuna
--   {"id": "ab12cd34", "t": "latte", "f": false}     (t = testo da 1 a 120 caratteri, f = fatto sì/no)
-- Vale anche per le voci delle liste condivise: chi è nella lista le vede e le spunta (con le regole che ci sono già).
-- Spuntare una riga NON manda notifiche alle altre persone della lista (solo aggiungere o completare la voce).
-- IMPORTANTE: va lanciato PRIMA di pubblicare la versione dell'app con le liste da spuntare.
-- Incolla tutto in Supabase > SQL Editor > Run. Si può rilanciare. Non tocca le voci esistenti.
-- (È incluso anche in schema.sql, punto 19.)
-- =========================================================

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
