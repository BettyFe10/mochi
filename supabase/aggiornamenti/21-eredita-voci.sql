-- =========================================================
-- MOCHI - Eliminazione account: le voci lasciate in liste da cui sei uscita/o restano a chi rimane
-- Problema: esci_dalla_lista() lascia le tue voci alla lista (voluto). Ma elimina_il_mio_account() passava a un'altra
-- persona solo le voci delle liste di cui eri ANCORA membro: le altre sparivano con l'account (on delete cascade),
-- e chi era rimasto nella lista perdeva dati. Ora passano al membro piu' anziano (entrata_at) di ogni lista, senza animale.
-- Limiti dell'erede (5000 voci, 20 MB): il passaggio non li controlla (cambia solo user_id), quindi l'eliminazione non
-- fallisce mai per questo. L'erede puo' ritrovarsi sopra il tetto: non perde niente, e per aggiungere voci nuove deve prima liberare spazio.
-- Una lista senza piu' membri non esiste piu' (sparisce con le sue voci): comportamento invariato.
-- Non serve una versione nuova della app. Non cambia nessun dato esistente. Si puo' rilanciare.
-- Incolla tutto in Supabase > SQL Editor > Run. (E' incluso anche in schema.sql, punto 28.)
-- =========================================================

create or replace function public.elimina_il_mio_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); l record; erede uuid;
begin
  if uid is null then raise exception 'Non autenticato'; end if;
  if not public.origine_consentita() then raise exception 'Origine non consentita'; end if;
  for l in select lista_id from public.liste_membri where user_id = uid loop
    select user_id into erede from public.liste_membri where lista_id = l.lista_id and user_id <> uid order by entrata_at, user_id limit 1;
    if erede is not null then
      update public.items set user_id = erede, animale_id = null where lista_id = l.lista_id and user_id = uid;
      update public.liste set proprietaria = erede where id = l.lista_id and proprietaria = uid;
    end if;
  end loop;
  -- Voci create in liste da cui sei GIA' uscita/o (esci_dalla_lista le lascia a chi resta): passano al membro piu' anziano
  -- di ogni lista, altrimenti sparirebbero con l'account (items.user_id e' on delete cascade).
  -- Il passaggio e' un UPDATE di user_id: non scattano items_limite (solo insert) ne' items_spazio (solo se cambia body/sottotask),
  -- quindi non puo' far fallire l'eliminazione. Se l'erede ha gia' molti dati puo' superare i tetti: non perde niente, e
  -- finche' non libera spazio non puo' aggiungere voci nuove (eliminare e accorciare passano sempre).
  -- Una lista senza piu' membri non esiste piu' (l'ultima persona che esce la cancella con le sue voci): niente da fare.
  update public.items i
     set user_id = (select m.user_id from public.liste_membri m where m.lista_id = i.lista_id order by m.entrata_at, m.user_id limit 1),
         animale_id = null
   where i.user_id = uid and i.lista_id is not null
     and not exists (select 1 from public.liste_membri m where m.lista_id = i.lista_id and m.user_id = uid)
     and exists (select 1 from public.liste_membri m where m.lista_id = i.lista_id);
  delete from auth.users where id = uid;
end $$;
revoke all on function public.elimina_il_mio_account() from public, anon;
grant execute on function public.elimina_il_mio_account() to authenticated;

-- CONTROLLO (dopo averlo lanciato, incolla e lancia questa query: deve rispondere true)
select (select prosrc like '%non esiste%' or prosrc like '%GIA'' uscita%' from pg_proc where oid = 'public.elimina_il_mio_account()'::regprocedure) as eredita_voci_uscite,
       has_function_privilege('authenticated', 'public.elimina_il_mio_account()', 'execute')
         and not has_function_privilege('anon', 'public.elimina_il_mio_account()', 'execute') as permessi_ok;
