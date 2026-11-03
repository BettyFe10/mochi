-- =========================================================
-- MOCHI - permessi al minimo indispensabile
-- Le funzioni interne (quelle che lavorano "dietro le quinte") non devono essere chiamabili da fuori,
-- nemmeno se non fanno danni. Non tocca nessun dato. Si può rilanciare.
-- (È incluso anche in schema.sql, punto 12.)
-- =========================================================
-- Funzioni che scattano da sole quando si salva una voce: nessuno deve poterle chiamare direttamente
revoke all on function public.voci_autore(), public.voci_attivita(), public.limite_per_utente() from public, anon, authenticated;
-- Controlli usati dalle regole di accesso: servono solo a chi ha fatto login
revoke all on function public.sono_membro(uuid), public.origine_consentita() from public, anon;
grant execute on function public.sono_membro(uuid), public.origine_consentita() to authenticated;
