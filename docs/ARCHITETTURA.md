# CTRL · Architettura

```
Telefono / computer
  └─ App CTRL (PWA, Netlify, cartella app/)
        │  POST text/plain {action, token, payload}
        ▼
  API Apps Script (backend/dist/Codice.gs) — esegue come Alessio
        ├─ Google Sheet  CTRL · DATABASE   (dati)
        ├─ Google Drive  CTRL/EVENTI…       (file, Fase 2)
        └─ Google Calendar CoolClub PRODUZIONE (sola lettura)
```

## Ambienti

| Ambiente | Server Apps Script | Database | Chi lo usa |
|---|---|---|---|
| Produzione | CTRL API | `CTRL/CTRL · DATABASE` | sito principale Netlify |
| Test | CTRL API TEST | `CTRL/_TEST/CTRL · DATABASE TEST` | anteprime Netlify (pull request) e sviluppo |

La scelta è automatica in `app/js/config.js`: i domini elencati in `PROD_HOSTS` usano la produzione, tutto il resto il test.
In alto compare il badge **TEST** quando si è sull'ambiente di prova.

## Sicurezza

- Accesso con codice di 6 cifre via email: 10 minuti, 5 tentativi, 1 invio al minuto e 5 all'ora per indirizzo.
  La risposta non rivela se un'email è autorizzata.
- Sessione di 30 giorni. Nel foglio c'è solo l'hash SHA-256 del token.
- Ruoli: ADMIN (solo l'email in `ADMIN_EMAIL`, sempre admin), COLLABORATORE (interruttori "può caricare file" e
  "può modificare contenuti"), LETTURA. Ogni azione controlla i permessi nel backend.
- Cambiare ruolo o disattivare un utente chiude subito le sue sessioni.
- Errori interni: al frontend arriva solo un messaggio generico, i dettagli restano nel registro di Apps Script.
- Netlify invia intestazioni di sicurezza (Content-Security-Policy, niente iframe, niente referrer): vedi `netlify.toml`.

## Dati

Tabelle in `backend/src/02_Schema.js`. Eventi:

- `origine = calendar`: titolo, date, orari, luogo, descrizione e colore arrivano dal Calendar (aggiornati ogni ora).
  Un evento sparito dal Calendar diventa `annullato`, ricompare `attivo` se torna. Gli `archiviati` non vengono toccati.
- `origine = manuale`: creati dall'admin in CTRL, modificabili interamente.
- Eventi ricorrenti: ogni occorrenza è un evento distinto (`cal_key = id@data`).
- Il colore è quello dell'evento sul Calendar; se l'evento non ne ha uno, quello del calendario.

## Attività automatiche (trigger Apps Script)

| Funzione | Quando | Cosa fa |
|---|---|---|
| `syncOraria` | ogni ora | legge il Calendar da 30 giorni fa a 365 giorni avanti |
| `backupSettimanale` | lunedì ore 4 | copia il database in `BACKUP/`, ne tiene 8 |
| `puliziaNotturna` | ogni notte ore 3 | elimina le sessioni scadute |

## Limiti noti

- Ogni chiamata all'API impiega circa 1-2 secondi (Apps Script): stima da misurare sul campo.
- Massimo 100 email al giorno da Apps Script con account Gmail: bastano perché i codici servono una volta ogni 30 giorni.
- Netlify gratuito: 300 crediti al mese (circa 20 pubblicazioni).
