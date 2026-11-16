# Istruzioni per chi sviluppa CTRL (persone e Claude)

CTRL è il gestionale della produzione eventi di Alessio Leo. Lingua del progetto, dell'interfaccia e dei messaggi: **italiano**.
Leggi questo file e `docs/ARCHITETTURA.md` prima di ogni modifica.

## Regole fisse

- **Non toccare** mai: il sito leolss.netlify.app e i suoi file, la cartella Drive `LEOT`, l'archivio `COOLCLUB`.
  CTRL lavora solo nella cartella Drive `CTRL` (produzione) e `CTRL/_TEST` (test).
- Il Google Calendar "CoolClub PRODUZIONE" si **legge soltanto**.
- Nessuna password, token o chiave nel repository. Gli ID delle cartelle non sono segreti, i token sì.
- Mai dichiarare pronta una funzione non testata. Ogni bug corretto aggiunge un test.
- Nessuna funzione "dimostrativa": ciò che compare nell'interfaccia deve funzionare davvero.

## Flusso di lavoro

1. Crea un ramo (`fase-2-sezioni`, `fix-sync-orari`…). Mai lavorare direttamente su `main`.
2. Modifica i sorgenti: `app/` (frontend) e `backend/src/` (Apps Script).
3. Se tocchi il backend: `npm run build` per rigenerare `backend/dist/Codice.gs`, e aumenta `CTRL_VERSION`
   in `backend/src/00_Config.js` (e `VERSION` in `app/sw.js` se cambia il frontend).
4. `npm test` deve passare: test del backend con Google simulato e test dell'app su desktop e telefono.
5. Guarda le schermate in `test-results/` prima di consegnare.
6. Aggiorna `CHANGELOG.md`.
7. Apri una pull request con: cosa cambia, file toccati, se serve aggiornare Apps Script, come verificarlo.
8. Alessio verifica l'anteprima Netlify (che usa il server di **test**) e approva. Poi si unisce in `main`.

## Convenzioni

- Backend: una scheda del foglio per tabella (`backend/src/02_Schema.js`). Colonne solo aggiunte in fondo, mai rinominate.
  Tutto testo (formato "@"). Nessuna cancellazione fisica: `stato`/`eliminato`. Ogni scrittura dentro `Db.withLock`
  e registrata con `Storico.log`. Permessi verificati sempre nel backend con `Users.require`.
- Solo `03_Db.js` parla con SpreadsheetApp: per cambiare database si riscrive solo quel file.
- Frontend: JavaScript senza framework né build, moduli ES in `app/js`. Nessuna libreria esterna caricata da CDN
  senza versione bloccata. Colori solo tramite le variabili in `app/css/ctrl.css`.
- Indicatori fissi: piano verde, materiale arancione, scheda tecnica verde con icona diversa.
- Netlify gratuito ha circa 20 pubblicazioni al mese: raggruppare le modifiche, non aprire PR per ogni ritocco.
