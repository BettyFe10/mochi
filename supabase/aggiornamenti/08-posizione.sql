-- =========================================================
-- MOCHI - Ordine dei post-it scelto trascinandoli
-- Aggiunge solo una colonna vuota: non cancella e non modifica nessuna voce. Si può rilanciare.
-- (È incluso anche in schema.sql, punto 16.)
-- =========================================================
alter table public.items add column if not exists posizione double precision;
alter table public.items drop constraint if exists items_posizione_ok;
alter table public.items add constraint items_posizione_ok check (
  posizione is null or (posizione > -1e15 and posizione < 1e15)
);
-- Controllo: deve rispondere 1
--   select count(*) from information_schema.columns where table_name = 'items' and column_name = 'posizione';
