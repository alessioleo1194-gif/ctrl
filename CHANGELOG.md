# Registro delle modifiche

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
