-- =========================================================
-- MOCHI - 12 colori per gli appunti (prima erano 5)
-- Allarga solo un controllo: non modifica nessuna voce esistente. Si può rilanciare.
-- =========================================================
alter table public.items drop constraint if exists items_color_ok;
alter table public.items add  constraint items_color_ok check (color is null or color between 1 and 12);
