# Registro delle modifiche

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
