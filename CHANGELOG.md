# Registro delle modifiche

## 0.13.1 · Il Viewer non ha Plan e Material List; inizio/fine evento accanto a Load-in e Load-out (anteprima su TEST)

- **Viewer (ospite)**: vede solo gli eventi a cui è assegnato e legge/scarica i file allegati. Production Plan e Material List non compaiono più
  (prima c'erano i pulsanti "Da compilare" e si aprivano i fogli in sola lettura). Il blocco è anche nel server: `documento.get` e `produzione.assicura`
  rispondono FORBIDDEN, e `eventi.get` non restituisce più il riepilogo dei documenti né l'id della produzione. Chi ha il permesso particolare "modifica"
  (o è Production/Owner) non cambia. Gli indicatori piano/materiale nell'elenco restano: indicano i PDF allegati.
- **Anteprima evento**: quando ci sono Load-in o Load-out, anche **Inizio** e **Fine** evento diventano riquadri nello stesso blocco
  (Load-in · Inizio · Fine · Load-out), senza ripetere l'orario nella riga di testo e senza che il luogo lo tagli. Senza Load-in/Load-out resta la riga di testo di prima.
- Test: Viewer (server e interfaccia, desktop e telefono), riquadri degli orari. Aggiornati i test che davano al Viewer la lettura dei fogli.

## 0.13.0 · Prestazioni: avvio in una chiamata, eventi che si aprono subito, cache dell'interfaccia (anteprima su TEST)

Causa principale: ogni chiamata ad Apps Script costa **1,2–1,9 s anche quando non fa quasi nulla** (misurato sul server di test), e l'app ne faceva molte **in fila**
e **bloccando lo schermo**. Nessuna funzione, regola, ruolo o dato è cambiato.

- **Avvio**: prima 3 chiamate una dopo l'altra (profilo → impostazioni → eventi), ora 1 (`app.avvio`). Se il server è una versione precedente, l'app ripiega sulle chiamate separate.
- **Apertura di un evento**: appare subito dai dati già in memoria (titolo, giornate, staff, note, documenti collegati); documenti, file e storico si riempiono quando arriva la risposta del server, che
  riallinea anche il resto. Se nel frattempo stai scrivendo una nota non viene mai ridisegnato sotto le mani. Un evento non più disponibile mostra lo stesso avviso di prima.
- **Cambio evento senza ricostruire la schermata**: la lista, la ricerca, i filtri e la posizione di scorrimento restano; cambia solo il dettaglio. Su telefono, tornando all'elenco si ritorna dove eri.
- **Elenco sempre aggiornato**: l'elenco in memoria si rilegge in background se ha più di 45 secondi e si ridisegna solo se qualcosa è cambiato (prima non si aggiornava mai nella stessa sessione).
- **Staff e turni**: assegnare, confermare, togliere, cambiare giornate o salvare un turno erano 3 chiamate in fila (modifica → rilettura evento → rilettura staff); ora è 1, perché `staff.gestisci` e `turni.salva`
  rispondono anche con l'evento aggiornato (campo `evento`, la lista dello staff resta com'era). La scheda si attenua subito al clic (feedback immediato) e non accetta doppi clic.
- **Backend**: la cache delle tabelle si svuota prima dell'autenticazione e non dopo: si evita una seconda lettura del foglio `utenti` in ogni richiesta (1 lettura in meno per chiamata).
- **Caricamento iniziale**: moduli dell'avvio 32 → 16 (210 → 97 KB); Impostazioni, Report, Production Plan e Material List si caricano solo quando le apri. I moduli dell'avvio si scaricano
  in parallelo (`modulepreload`). Il service worker ora serve tutti i file dell'interfaccia dalla memoria del dispositivo (prima ne riscaricava/rivalidava una cinquantina a ogni apertura).
  **Attenzione**: i file restano in cache finché `VERSION` in `app/sw.js` non cambia; il nuovo test controlla che l'elenco sia completo.
- **Impostazioni**: il Registro accessi (la tabella più grande) si carica dopo che la pagina è già visibile.
- **Ricerca**: la lista si ridisegna una volta sola quando ci si ferma un istante, non a ogni lettera.
- **Correzione collaterale**: l'indicatore dei file nella lista si aggiorna anche quando evento aperto ed evento dell'elenco sono lo stesso oggetto (con test già esistente).
- Test: 6 backend (`prestazioni.test.mjs`), 5 unit (`sw.test.mjs`), 8 e2e desktop+telefono (`prestazioni.spec.mjs`, con server finto lento). Misura delle letture dei fogli: `node scripts/perf-mock.mjs`.
- **CI**: il controllo automatico falliva dalla 0.12.0 perché sul server mancava `openpyxl` (serve al test dell'export Excel); ora viene installato, e girano anche i test unitari.
- Apps Script: nuova versione del deployment (schema invariato, setup non necessario). Il frontend resta compatibile con il server 0.12.1 (ripiega sulle chiamate separate).

## 0.12.1 · Load-in/Load-out nell'anteprima e striscia tra una giornata e l'altra (anteprima su TEST)

- **Elenco eventi**: nel riquadro dell'evento compaiono subito **Load-in** (bordo verde) e **Load-out** (bordo arancione), letti dal Production Plan giornata per giornata.
  Più righe nello stesso giorno: Load-in = il più presto, Load-out = il più tardo; orari non leggibili ("TBD") si ignorano; se il piano non li ha, non compare nulla.
  Li ricevono solo le persone che possono vedere i documenti dell'evento (Owner, staff assegnato). Nessuna scrittura: se cambi il piano, cambiano da soli.
- **Giorni separati**: a ogni cambio di giorno c'è una striscia colorata con la data per esteso e il numero di eventi ("GIOVEDÌ 19 NOVEMBRE · 2 eventi"); oggi è evidenziata
  a tinta piena, i giorni passati sono attenuati. Gli eventi dello stesso giorno restano insieme, ordinati per orario.
- Nuovo campo `plan` in ogni giornata di `eventi.list` / `eventi.get`. Schema invariato: dopo l'aggiornamento di Apps Script basta una nuova versione del deployment (setup non necessario).
- Test: 4 backend (`anteprima.test.mjs`), 3 e2e desktop+telefono (`anteprima.spec.mjs`).

## 0.12.0 · Staff Work Report, export Excel e statistiche sul nome (anteprima su TEST)

- **Staff Work Report (solo Owner, icona nella barra in alto)**: una riga per tecnico e per giornata, letta dai turni — niente archivio a parte, quindi si aggiorna da solo con
  assegnazioni, giornate e orari. Colonne: Data, Giorno, Tecnico, Evento, Location, Inizio, Fine, Durata, Nota. Filtri: anno, mese (di default il mese corrente), tecnico, evento, dal/al.
  Un tocco sul tecnico (o sul suo riepilogo) mostra lo storico di quella persona. Si contano solo le **giornate** (nessuna distinzione eventi/giornate) e le ore **pianificate**.
  Le giornate che finiscono dopo la mezzanotte restano nella data di inizio. Gli eventi annullati restano in elenco, barrati e segnalati, ma non entrano nei totali. Su telefono la tabella diventa a schede.
- **Esporta report mensile (.xlsx)**: file Excel vero con tre fogli (WORK LOG, TECHNICIAN SUMMARY, EVENT SUMMARY), intestazione bloccata, filtri, formule per le ore e per i riepiloghi
  (il file resta corretto se si cambia un orario), nome `STAFF_WORK_REPORT_NOVEMBER_2026.xlsx`. Gli eventi annullati non vengono esportati. Generato nel browser: nessun dato esce da CTRL.
- **Popup sul nome (solo Owner)**: sul desktop passando il cursore, su telefono e tablet toccando il nome (non apre l'evento; si chiude con Esc, tocco fuori o X). Mostra, per il mese corrente:
  Giornate lavorate, Giornate future, Ore lavorate (ore pianificate delle giornate già concluse; oggi conta come futura finché il turno non finisce). Dati riletti dal server, al massimo ogni 30 secondi.
- Solo l'Owner: i controlli sono nel server (`report.righe`, `report.statistiche` rifiutano chiunque altro, anche con chiamata diretta). Nessun dato storico viene modificato o cancellato.
- **Correzione (0.11.0)**: nella riga del turno di una giornata poteva comparire la scritta "null" (elemento assente scritto come testo). Corretto, con test.
- Test: 9 backend (`report.test.mjs`), 4 unit sul file Excel (`xlsx.test.mjs`), 5 e2e desktop+telefono (`report.spec.mjs`, con download e verifica del contenuto del file).

## 0.11.0 · Giornate, orari modificabili e disponibilità dello staff (anteprima su TEST)

- **Giornate**: ogni evento ha una sezione per giornata ("Giorno 2 di 3"), generata dal Calendar. Evento di un solo giorno = una giornata, anche se a cavallo della
  mezzanotte (22:00–02:00 = una giornata, "+1 giorno"). Su più giorni: il primo prende l'inizio, l'ultimo la fine, gli altri orari restano "da definire".
  Owner e Production correggono orari e nota di ogni giornata, aggiungono giornate a mano (montaggio, smontaggio) e le tolgono (almeno una resta; con staff assegnato serve conferma).
- **Orari che non si perdono**: un orario corretto in CTRL ("Modificato da te") non viene mai sovrascritto dalla sincronizzazione. Se il Calendar cambia dopo,
  compare la differenza e si sceglie "Tieni la mia" o "Usa quello del Calendar"; "Ripristina Calendar" riporta l'orario originale.
- **Elenco eventi**: una riga per giornata sotto la sua data. Ricerca e "Solo i miei" restano per evento.
- **Turni**: ogni persona assegnata ha un turno per giornata ("tutte le giornate" o solo alcune; le giornate aggiunte dopo vanno a chi lavora su tutte).
  Orario del turno = quello della giornata, o uno suo scritto dall'Owner. Solo l'Owner assegna e modifica i turni.
- **Controllo disponibilità (solo Owner, mai bloccante)**: prima di assegnare, per ogni giornata: rosso = orari che si sovrappongono (anche oltre la mezzanotte),
  arancione = stessa data ma orario mancante (da verificare), azzurro = stesso giorno, orari compatibili, verde = libero. Due orari che si toccano (23:00/23:00) non si sovrappongono.
  "Assegna comunque" e "Assegna solo i giorni liberi". Ricalcolato da solo se cambiano orari, giornate o staff; un evento annullato non occupa nessuno. ⚠ nell'elenco.
- Schema 8: tabelle `giorni` e `turni`, colonna `giorni_tutti` in `assegnazioni` (solo aggiunte). La migrazione crea le giornate degli eventi esistenti e un turno per ogni
  assegnazione confermata; è ripetibile e non modifica né toglie nulla. **Dopo l'aggiornamento di Apps Script va rilanciato il setup.**
- Nuove azioni API: `giorni.salva/calendario/aggiungi/rimuovi`, `staff.verifica`, `turni.salva`; `staff.gestisci` accetta `giorni` e l'azione `giorni`.
- Test: 21 backend nuovi (`giornate.test.mjs`), 10 e2e nuovi desktop+telefono (`giornate.spec.mjs`), 2 e2e adattati all'elenco per giornata.

## 0.10.2 · Indirizzo del sito operativo (17/11/2026)

- Il sito operativo si chiamerà **ctrl-leo.netlify.app** ("ctrl.netlify.app" è di un altro sito). `PROD_HOSTS` elenca sia il nuovo nome sia il vecchio,
  quindi l'app parla con la produzione con entrambi; qualsiasi altro indirizzo (anteprime, rami, locale) resta sul TEST. Test dedicato.
- Solo frontend (`CTRL_VERSION` del backend resta 0.10.1). Il rinomino su Netlify avviene al rilascio, non prima.

## 0.10.1 · Il Viewer vede solo i suoi eventi (17/11/2026)

- **Chi ha solo lettura (Viewer) vede soltanto gli eventi a cui è assegnato**, prossimi e passati. Gli altri non compaiono né nell'elenco né per nome né da link diretto
  ("Evento non trovato"): il blocco è nel server (`eventi.list`, `eventi.get`). Owner e Production vedono tutti gli eventi, passati compresi.
- Il permesso particolare "Vede i documenti di tutti gli eventi" apre anche l'elenco completo (come un Production, ma resta in sola lettura).
- Per il Viewer sparisce il filtro "Solo i miei" (inutile) e, senza assegnazioni, l'elenco dice "Non sei assegnato a nessun evento in programma.".
- Assegnare o togliere un evento vale subito, senza nuovo login. Una proposta dal Calendar non apre nulla finché l'Owner non conferma.
- Nel festival il Viewer assegnato a un giorno vede solo quel giorno nell'elenco; Plan, Material List e file della produzione restano accessibili come prima.
- Nuovo permesso nel profilo: `vedereEventi`. Nessuna modifica allo schema: **non serve rilanciare il setup**, basta aggiornare Apps Script.
- Test: 8 nuovi (`visibilita.test.mjs`), 4 adattati; backend 92, unit 7.
- La scritta TEST accanto al logo resta sull'anteprima e sul server di prova; sul sito di produzione non compare.

## 0.10.0 · Gestione utenti completa e telefono (17/11/2026)

- **Utenti**: campo unico "Nome e cognome"; **email modificabile** (stessa riga, stesso colore e assegnazioni, sessioni chiuse, nuovo codice al prossimo accesso;
  rifiutata se già in uso); stato **Attivo / Sospeso**; **Elimina utente** con doppia conferma (nessuna cancellazione fisica: `eliminato`, sessioni chiuse,
  assegnazioni confermate rimosse, proposte decadute; la stessa email può chiedere di nuovo l'accesso). Il proprietario è protetto e si chiama **"Alessio Leo"**
  (non "Admin"). Le modifiche valgono subito anche per chi è già dentro.
- **Permessi particolari** (spenti di default, per singolo utente): vede i documenti di tutti gli eventi, può caricare file, può modificare Plan e Material List.
- **Registro accessi**: nuovi eventi `email_cambiata`, `permessi`, `eliminato`.
- **Telefono**: Production Plan e Material List mostrano un **elenco di righe** con editor a schermo intero (un campo per colonna, Prec./Avanti, + Riga sotto,
  Elimina con conferma). Il documento non cambia. Sotto i 700 px tocchi da 44 px e campi da 16 px (niente zoom di iOS). Viewer: sola lettura.
  Su tablet e desktop resta il foglio a celle.
- **Correzione**: l'aggiornamento tecnico dell'ultimo accesso poteva dare un falso CONFLICT sulla riga utente; ora non cambia la versione (test dedicato).
- Backend: schema 7 (`utenti.permessi_extra`, `eliminato`, `eliminato_il`); azione nuova `utenti.elimina`.
  **Dopo aver aggiornato Apps Script rilancia `setupProduzione` / `setupTest`** (aggiunge le colonne e rinomina l'Owner in "Alessio Leo").
- Test: 84 backend, 7 unit, e2e desktop e telefono.

## 0.9.0 · Staff negli eventi (17/11/2026) · Fase 3 di 4

- **Assegnazione dello staff** (solo Owner): scheda "Staff" nel dettaglio evento con assegnati, proposte e aggiunta manuale.
  Dalle descrizioni del Calendar nascono **proposte** (cerca il "nome in calendario" di ogni utente, parola intera, senza maiuscole né accenti).
  Nessuna proposta vale finché l'Owner non la conferma; "Non è lui" la scarta e CTRL se lo ricorda; "Ripristina" la riporta in attesa.
  Conferme, assegnazioni manuali e scartati non cambiano con la sincronizzazione; una proposta non gestita decade se il nome sparisce.
- **Documenti riservati**: chi non è assegnato vede l'evento (titolo, data, luogo, descrizione, nomi dello staff) ma non Production Plan,
  Material List, file e note. Il blocco è nel server, anche chiamando le azioni a mano. Per i festival basta essere assegnati a un evento
  della produzione. L'Owner vede tutto. Gli eventi li vedono tutti.
- **Nomi colorati sulle card**: primi due nomi e "+N", colore per persona uguale ovunque; il tuo nome è pieno. L'Owner vede il badge "N da confermare".
- **Solo i miei**: filtro nella lista eventi.
- **Impostazioni → Utenti**: campi "Nome in calendario" e "Colore" (8 colori; assegnato in automatico il meno usato, modificabile).
- Backend: tabella nuova `assegnazioni`, colonne `nome_calendario` e `colore` in `utenti` (schema 6). Azioni nuove: `staff.evento`, `staff.gestisci`.
  `eventi.list` / `eventi.get` aggiungono `staff`, `mio`, `accesso`, `da_confermare`; le note escono solo per chi ha accesso.
  **Dopo aver aggiornato Apps Script, rilancia `setupProduzione` / `setupTest`** (crea la tabella, aggiunge le colonne e dà un colore a chi non lo ha).

## 0.8.0 · Accessi: scadenza, richieste, registro, disconnessione remota (17/11/2026) · Fase 2 di 4

- **Scadenza per utente**: campo "Accesso valido fino al" (ultimo giorno, ora italiana). Dal giorno dopo il login dice "Accesso scaduto",
  le sessioni aperte non valgono più e ogni notte vengono chiuse. Il proprietario non scade mai. Una data non valida nel foglio vale "scaduto".
  Nell'elenco: tag "Scade tra N giorni", "Scaduto il …", filtri Tutti / Attivi / In scadenza / Scaduti, pulsanti **+30 giorni** e **Riattiva +30 giorni**.
- **Richieste di accesso**: dalla schermata di login chi non ha un account può chiederlo (email, nome, messaggio). La risposta è sempre la stessa,
  esista o no l'account. Massimo 3 richieste all'ora in totale. Il proprietario riceve al più una email di avviso all'ora (senza testo scritto da chi richiede),
  approva scegliendo ruolo (Production / Viewer) e durata, oppure rifiuta (stessa email bloccata 7 giorni). Non parte nessuna email alla persona.
- **Registro accessi** (solo Owner): accessi, uscite, codici errati e accessi scaduti di utenti esistenti, richieste e loro esito, cambi di ruolo,
  scadenza e stato, disconnessioni remote. Con filtri e ricerca. Mai codici, token né tentativi di email sconosciute; l'IP non è disponibile.
  Si conserva 180 giorni, poi si cancella da solo (come le sessioni).
- **Dispositivi connessi** per utente, con **disconnessione remota** di uno o di tutti (efficace alla richiesta successiva del dispositivo).
- Layout impostazioni: la pagina non si allarga più su telefono.
- Backend: tabelle nuove `richieste_accesso` e `accessi`, colonna `scade_il` in `utenti` (schema 5). Azioni nuove: `accesso.richiedi`, `accesso.richieste`,
  `accesso.gestisci`, `accessi.list`, `utenti.proroga`, `utenti.sessioni`, `utenti.disconnetti`.
  **Dopo aver aggiornato Apps Script, rilancia `setupProduzione` / `setupTest`** (crea le tabelle e la colonna, non tocca i dati).

## 0.7.0 · Ruoli OWNER / PRODUCTION / VIEWER (17/11/2026) · Fase 1 di 4

- Ruoli nuovi, applicati dal server: **OWNER** (solo l'email `ADMIN_EMAIL`, non si assegna a nessuno e non si può declassare),
  **PRODUCTION** (vede tutto, scarica PDF, carica file, crea e modifica Production Plan e Material List),
  **VIEWER** (sola lettura). Eventi, impostazioni, utenti, template, sincronizzazione e storico restano solo dell'Owner.
- Gestione utenti: ruolo a scelta tra Production e Viewer, Owner mostrato e non modificabile; tolti i due interruttori "carica" e "modifica".
- Migrazione: il setup riscrive i ruoli vecchi (altri ADMIN e COLLABORATORE con modifica → Production, gli altri → Viewer) e
  disconnette chi perde permessi. Fino al setup i ruoli vecchi sono già letti come i nuovi. **Dopo aver aggiornato Apps Script, rilancia `setupProduzione` / `setupTest`.**
- Le colonne `puo_caricare` / `puo_modificare` restano nel foglio ma non contano più.

## 0.6.0 · PDF archiviato al salvataggio (17/11/2026)

- **Save Changes** su Production Plan e Material List salva il documento e genera il PDF, archiviato come file dell'evento
  (sezione piano o materiale, cartella Drive dell'evento). L'icona dell'evento si accende.
- Un solo PDF per documento: il salvataggio successivo lo sostituisce, il vecchio va nel cestino di Drive (30 giorni).
- Dopo il salvataggio automatico la barra dice "PDF da aggiornare (Save Changes)"; se il PDF non si crea il documento
  resta salvato e il messaggio lo spiega.
- Festival: il PDF compare in tutti gli eventi collegati.
- Backend: nuova azione `documento.pdf`, nessuna nuova tabella (serve solo aggiornare il codice Apps Script, non il setup).

## 0.5.1 · Material List senza colonna Unit (17/11/2026)

- Tolta la colonna **Unit** dalla Material List (foglio, PDF, Copy Text, incolla da Excel: Item · Quantity · Notes).
- I valori Unit già salvati restano nei dati, non si vedono né si esportano. Backend invariato.

## 0.5.0 · Production Plan e Material List come fogli di lavoro (17/11/2026)

Sostituisce la scheda di produzione e il programma a righe delle versioni 0.3–0.4 (mai andati in produzione).

- **Production Plan** e **Material List** si aprono direttamente dal dettaglio evento come fogli già pronti: nessuna
  panoramica, nessuna finestra, nessun pulsante "aggiungi".
- Griglia nativa: ogni cella si scrive direttamente, frecce/Tab/Invio, Ctrl+Invio inserisce riga, Ctrl+Canc la toglie,
  Ctrl+D riempie in basso, Ctrl+Z/Y annulla e ripete, selezione con Maiusc+frecce o trascinando, **copia/incolla di blocchi da Excel**.
- Plan: intestazione dall'evento, Technical Crew (suggerisce persone già usate e compila ruolo e contatti), Production Schedule
  00:00–24:00 ogni 30 minuti, 19 attività nel menu più testo libero, colonna Section (Pre Show / Show / altre),
  orari veloci (`1645`, `1645-1830`), una scheda per giornata dei festival, "Sort by time".
- Material List: location illimitate scrivendone il nome, voci con Quantity/Unit/Notes, **duplica location**, libreria
  dei materiali già usati (aiuto, non obbligo).
- Documento finale: Generate PdP / Generate list, Copy Text, Print / Save PDF, Download PDF, inglese o italiano.
- Salvataggio automatico con unione delle modifiche se due persone lavorano insieme; riprova da solo se manca la rete.
- Un festival (più eventi) condivide un solo Plan e una sola Material List (menu nel dettaglio evento).
- **Backend:** schema v4 (`documenti`, `documenti_parti`); rimossi giornate, spazi, squadra e rubrica dall'interfaccia
  (le tabelle restano nel foglio). Serve aggiornare Apps Script e rieseguire il setup.

## 0.4.0 · Scheda di produzione, tappa 2: programma (Production Schedule) e PDF (17/11/2026)

- Nuovo blocco **Programma** nella scheda di produzione: una tabella per giornata con Start, End, Activity,
  Location, Responsible, Details / Notes. Pulsante **Add Activity**, attività illimitate.
- **Activity** da un menu di 22 voci in inglese (Load-in, Soundcheck, Doors Open, Load-out…) più **Custom Activity**.
- Orari scritti in fretta (`1630`, `16.30`, `9`) diventano `16:30`, `09:00`; un orario sbagliato è segnalato e non salvato.
- **Ordine cronologico** automatico; la giornata operativa va dalle 06:00 alle 05:59 (un load-out all'01:00 resta
  nella giornata dello show). Le frecce ordinano solo le attività con lo stesso orario.
- **Duplica** (riparte dalla fine dell'originale, con la stessa durata), **togli** con conferma, **Invio** per scendere
  di riga o aggiungerne una nuova. Una nuova attività parte dalla fine della precedente.
- **Location** dagli spazi della struttura, con «+ Nuovo spazio…» direttamente dalla riga; **Responsible** con
  suggerimenti dalla squadra e dai nomi già usati.
- **Avvisi**: sovrapposizioni nello stesso spazio o con lo stesso responsabile, attività senza tipo o senza orario,
  durate oltre 12 ore. Non bloccano il salvataggio.
- **Note della giornata.**
- **Documento e PDF**: anteprima sul sito, PDF A4 scaricabile (italiano o inglese, una o tutte le giornate, contatti
  della squadra facoltativi) e stampa del solo documento. Il PDF si crea nell'app con jsPDF 4.2.1 e
  jspdf-autotable 5.0.9, copiati in `app/vendor` (versioni bloccate, nessun CDN).
- Le regole del programma sono scritte una volta (`backend/src/24_Programma.js`) e copiate nell'app da `npm run build`.
- Togliere una giornata toglie anche le sue attività (la conferma dice quante); togliere uno spazio lascia
  le attività senza spazio.
- Database: colonne aggiunte a `attivita` (`progetto_id`, `giornata_id`, `spazio_id`, `tipo`) e a `giornate` (`note`).
  Dopo l'aggiornamento del codice va rieseguito il setup.

## 0.3.0 · Scheda di produzione, tappa 1: fondamenta (16/11/2026)

Riprogettazione approvata: https://claude.ai/artifact/KA68oPNgFcFPLGdnNMJWYQ

- Nuova **scheda di produzione** per evento (pagina dedicata `#/p/<id>`): panoramica con stato dei blocchi
  e avvisi, **Struttura** (giornate e spazi), **Persone** (squadra dalla rubrica comune).
- Si crea dal dettaglio evento: giornate dalle date dell'evento, uno spazio dal suo luogo.
- **Festival:** più eventi del Calendar nella stessa scheda; le giornate si aggiungono da sole.
- **Salvataggio automatico** a lotti, con indicatore; se la rete cade riprova senza perdere né duplicare dati.
- **Rubrica persone** comune a tutti gli eventi: chi può modificare aggiunge e modifica, solo l'admin toglie.
- Le righe a mano di piano, materiale e scheda tecnica della 0.2.0 sono state tolte (mai andate in produzione):
  restano i **file allegati** su Drive, raggruppati in un unico riquadro.
- Corretto: le date inesistenti (es. 30 febbraio) non sono più accettate.
- Database: nuove tabelle `giornate`, `persone`, `squadra`; colonne aggiunte a `progetti` e `location`.
  Dopo l'aggiornamento del codice va rieseguito il setup (aggiunge solo ciò che manca).

## 0.2.0 · Fase 2, sezioni di produzione (16/11/2026)

- Ogni evento ha tre sezioni: **piano di produzione**, **lista materiale**, **scheda tecnica**.
  Ognuna si compila con righe strutturate, testo libero e file allegati, anche insieme.
  - Piano: inizio, fine, attività, responsabile, note.
  - Materiale: quantità, voce, area e provenienza (tendine delle impostazioni), note.
  - Scheda tecnica: channel list (n., sorgente, microfono, DI, asta, note) con numerazione automatica.
- File allegati salvati su Drive nella cartella dell'evento (creata al primo caricamento), massimo 20 MB per file.
  Download dall'app per tutti i ruoli; tolti finiscono nel cestino di Drive (solo admin o chi li ha caricati).
- Indicatori della lista aggiornati subito dopo ogni salvataggio.
- Protezione dalle sovrascritture per sezione: se un altro salva prima, l'app avvisa e non perde dati.
- Salvare la cartella Drive di un evento non invalida più le modifiche aperte sulle note.

## 0.1.1 · Correzione setup (16/11/2026)

- Setup: il nome del foglio iniziale ora si legge prima di eliminarlo. Su Google la vecchia versione si fermava
  con "Foglio … non trovato" dopo aver creato le tabelle, senza creare admin, attività automatiche e prima sincronizzazione.
- Simulatore dei test: un foglio eliminato non è più utilizzabile, come su Google.
- CI: lockfile rigenerato dal registro npm.

## 0.1.0 · Fase 1, fondamenta (16/11/2026)

- Server Apps Script con API unica, ambienti produzione e test separati.
- Accesso con codice via email, sessioni di 30 giorni, ruoli ADMIN / COLLABORATORE / LETTURA con interruttori.
- Sincronizzazione dal Calendar "CoolClub PRODUZIONE": aggiornamenti, eventi annullati e riattivati, più giorni,
  tutto il giorno, ricorrenze, descrizione e colore. Ogni ora in automatico.
- Eventi manuali (solo admin), note di produzione, archiviazione.
- Impostazioni: utenti, liste a tendina (aree, provenienze), sincronizzazione manuale, tema.
- Storico delle modifiche, backup settimanale del database.
- App installabile (PWA), progettata per telefono e computer, tema chiaro e scuro.
- Corretti i difetti del test precedente: id salvati come numero, fuso orario del foglio, eventi su più giorni,
  descrizione non importata, eventi spostati o cancellati non aggiornati.
