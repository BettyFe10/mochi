# Mochi - istruzioni per Claude Code

Web app PWA kawaii in italiano (cose da fare, appuntamenti, appunti, spesa, turni, spese, umore, serie, casette, feste, pet...). IN PRODUZIONE e usata ogni giorno da persone vere: zero regressioni, massima attenzione al database. Sito su GitHub Pages (repo BettyFe10/mochi), backend Supabase.

## Come rispondere a Betty
Italiano. Niente trattini lunghi (solo "-"). Prima frase: la verità scomoda o una domanda che mette in discussione l'ipotesi. Tag [CERTO]/[PROBABILE]/[IPOTESI] prima delle affermazioni. Mai: "Ottima domanda", "Hai perfettamente ragione", "Ha perfettamente senso", "Assolutamente", "Senza dubbio". Disaccordo: "Non sono d'accordo perché... Al tuo posto farei... Il rischio è...". Mantieni la posizione salvo informazioni nuove. Niente introduzioni.

## Regole che non si discutono
- Commit e push li fa Betty con GitHub Desktop. Tu NON fai git commit/push, niente co-author o firme AI.
- Se tocchi il database: SQL idempotente in supabase/aggiornamenti/NN-nome.sql (+ sezione in schema.sql, + LEGGIMI.md), query di controllo in fondo, test su copia (PGlite) con attacchi (utente B contro A, anonimo, valori assurdi, script lanciato due volte). Betty lo lancia su Supabase PRIMA del push.
- Mai chiavi nel frontend né in chat. Mai sb_secret_/service_role nel sito. config.js resta vuoto nel repo (le chiavi arrivano dai GitHub Secrets).
- CSP `script-src 'self'`: niente script inline, niente CDN, font locali. Ogni dato utente passa da `esc()`.
- Il workflow `.github/workflows/pubblica.yml` copia un ELENCO FISSO di file (index.html app.js frasi.js tema.css privacy.html privacy.js config.js mascotte.js sw.js manifest.webmanifest icons vendor). Un file nuovo non elencato non viene pubblicato. Quel file lo modifica solo Betty.
- A ogni consegna alza `CACHE = "mochi-vNN"` in sw.js.
- Quattro stili con `html[data-stile]`: morbido (predefinito, non cambiarlo senza permesso), cartone, quaderno, sobrio. Ogni componente nuovo deve rendere bene in tutti e quattro, chiaro e scuro, a 340/390/1280 px. Regole in DESIGN.md.
- Testi con genere: usa l'helper `gen(neutro, lei, lui)` (pronomi dell'utente in CUSTOM.pronomi).

## Mappa del codice (non leggere i file interi: sono grandi, usa Grep)
- app.js (~4800 righe): tutta l'app. Cerca per nome: viewMenu, openSettings, giardinoSvg, scenaCasa, cleanCustom, applyName, saveCustom, portaPreferenze, clearLocal, MODULI, STILI, PALETTE, CASETTE, MOBILI, FIORI, UMORI, calcolaSerie, festaDi.
- index.html: tutto il CSS (+ sprite SVG). tema.css: colori, chiaro/scuro, palette. mascotte.js: le 15 mascotte e gli accessori. frasi.js. sw.js. privacy.html/js. manifest.webmanifest. supabase/.
- Preferenze utente: oggetto CUSTOM, sincronizzato in user_metadata, validato con whitelist in cleanCustom (aggiungi lì ogni campo nuovo, scarta tutto il resto), azzerato in clearLocal, unione ospite->account in portaPreferenze/accountHaPreferenze.
- Ospite: LocalStore in localStorage (ONLINE_MODE = CONFIG_ONLINE && !OSPITE).

## Stato dei lavori e coda (aggiornare qui a ogni consegna)
Vedi il documento del progetto "claude/contesto-e-istruzioni.md" su claude.ai (Project "App Mochi") per lo stato aggiornato. Coda decisa da Betty: menu e impostazioni a gruppi + fix overflow iPhone (in verifica), micro-sprint contrasto AA palette storiche, Pet (un animale per persona, scheda + scadenze + routine + spese, con tabella pet_registro: BRIEF_pet.md nel kit test), backup automatico (rimandato), app nativa (alla fine).

## Risparmio di token e consumi (IMPORTANTE)
- Usa Sonnet per tutto il lavoro di codice; Opus solo per revisione indipendente, piani e bug difficili. Haiku per ritocchi di testo/CSS.
- Non leggere mai app.js/index.html per intero: Grep del simbolo, poi Read con offset/limit di 40-80 righe.
- Una modifica alla volta, piccola. Niente rifattorizzazioni non richieste. Niente file nuovi non richiesti.
- Prima di cercare/leggere molto, chiediti se basta il documento di contesto. `/clear` tra un lavoro e l'altro, `/compact` dopo ~60% di contesto, mai conversazioni infinite.
- Test: lancia SOLO quelli che toccano ciò che hai cambiato; la suite completa una volta a fine lavoro. Test lenti e sensibili al carico (t_feste, t_casette, t_serie, t_sobrio) da soli, mai in parallelo. Kit in ~/Desktop/mochi-test (fuori dal repo).
- Per verifiche indipendenti usa un sub-agente con brief corto (cosa è cambiato, cosa attaccare, cosa riportare), non rileggere tutto tu.
- Risposte finali brevi: cosa è cambiato, file toccati, numeri dei test, limiti, passi per Betty. Niente riassunti dei passaggi.
