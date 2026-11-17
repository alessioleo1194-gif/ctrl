# Registro delle modifiche

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
