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
- Ruoli: OWNER (solo l'email in `ADMIN_EMAIL`), PRODUCTION (crea e modifica Plan e Material List, carica file),
  VIEWER (sola lettura). Ogni azione controlla i permessi nel backend (`Users.require`). Ogni utente può avere una scadenza
  (`scade_il`); richieste di accesso, registro accessi e dispositivi connessi sono in `13_Accessi.js` e `14_Richieste.js`.
- Visibilità degli eventi (`Staff.contesto().vede`): Owner e Production vedono tutti gli eventi; il VIEWER solo quelli a cui è assegnato
  (confermata), passati compresi, salvo il permesso `tutti_documenti` (`vedereEventi`). Un evento non visibile risponde NOT_FOUND.
- Staff (`15_Staff.js`): chi non è assegnato a un evento ne vede i dati ma non documenti, file e note; il controllo è nel
  backend (`Staff.richiediEvento` / `richiediProduzione`), non solo nell'interfaccia.
- Cambiare ruolo, email o stato, sospendere o eliminare un utente chiude subito le sue sessioni. L'eliminazione è logica
  (`utenti.eliminato`): la riga resta per lo Storico. Permessi particolari in `utenti.permessi_extra` (JSON: `tutti_documenti`,
  `carica`, `modifica`), applicati da `Users.perms`; l'Owner ha sempre tutto e non è modificabile. Il nome dell'Owner è sempre "Alessio Leo".
- Errori interni: al frontend arriva solo un messaggio generico, i dettagli restano nel registro di Apps Script.
- Netlify invia intestazioni di sicurezza (Content-Security-Policy, niente iframe, niente referrer): vedi `netlify.toml`.

## Dati

Tabelle in `backend/src/02_Schema.js`. Eventi:

- `origine = calendar`: titolo, date, orari, luogo, descrizione e colore arrivano dal Calendar (aggiornati ogni ora).
  Un evento sparito dal Calendar diventa `annullato`, ricompare `attivo` se torna. Gli `archiviati` non vengono toccati.
- `origine = manuale`: creati dall'admin in CTRL, modificabili interamente.
- Eventi ricorrenti: ogni occorrenza è un evento distinto (`cal_key = id@data`).
- Il colore è quello dell'evento sul Calendar; se l'evento non ne ha uno, quello del calendario.

Documenti di produzione: una produzione (`progetti`, `23_Produzioni.js`) raggruppa uno o più eventi (un festival ne ha
molti) e si crea da sola alla prima apertura (`produzione.assicura`). Ha due documenti, **Production Plan** (`plan`) e
**Material List** (`materiali`), gestiti da `24_Documenti.js`: ogni documento è un JSON salvato per intero in `documenti`,
spezzato in parti da 30.000 caratteri in `documenti_parti` (limite delle celle). Salvataggio ottimistico:
`documento.salva` manda la versione letta; se è cambiata risponde `{conflitto: true, dati}` (un dato, non un errore) e
l'app unisce le due versioni riga per riga e campo per campo (`app/js/unisci.js`) e rinvia. I dati in arrivo sono
ripuliti e limitati nel backend. I suggerimenti (crew e materiali già usati in altre produzioni) arrivano con `documento.get`.

Interfaccia a foglio: `app/js/grid.js` è la griglia nativa (celle di testo, tastiera, selezione, copia/incolla TSV da/verso
Excel con `tsv.js`, annulla/ripeti, elenchi filtrati); `views/plan.js` e `views/materiali.js` la usano dentro il guscio
`views/foglio.js` (caricamento, salvataggio automatico `salvataggio.js`, passaggio al documento). Il documento finale
(`views/doc.js`) usa `documento-dati.js` per anteprima, testo copiato e PDF (`pdf.js`, jsPDF in `app/vendor`, caricato solo quando serve).
Nel Plan la colonna Section vale per tutte le righe sotto finché non ne scrivi un'altra (si parte da Pre Show);
le righe restano dove le scrivi, "Sort by time" le ordina, il documento è sempre ordinato per orario.

Telefono: sotto i 700 px `creaGriglia` (grid.js) restituisce `creaRigheMobile` (`righe-mobile.js`): elenco di righe e editor
a schermo intero, stesse opzioni e stessi dati del foglio a celle (che resta su tablet e desktop).

Staff e assegnazioni (`15_Staff.js`, tabella `assegnazioni`): solo l'Owner assegna. Dalla descrizione del Calendar nascono
**proposte**: CTRL cerca nel testo il "nome in calendario" di ogni utente attivo e non scaduto (`utenti.nome_calendario`,
alias separati da virgola; se vuoto, il primo nome di almeno 3 lettere), a parola intera, senza maiuscole né accenti.
Una proposta non dà alcun accesso finché l'Owner non la conferma. Stati: `proposta`, `confermata`, `scartata` ("non è lui",
ricordata), `rimossa` (tolta a mano), `decaduta` (il nome non c'è più). La sync e le modifiche a utenti ed eventi ricalcolano
le proposte (`Staff.ricalcola_`) senza toccare conferme, assegnazioni manuali e scartati. Accesso a documenti, file e note:
Owner sempre; gli altri se assegnati all'evento o a un evento della stessa produzione (festival). Ogni utente ha un colore
(`utenti.colore`, tavolozza `COLORI_UTENTE`), lo stesso su card, dettaglio e impostazioni.

## Attività automatiche (trigger Apps Script)

| Funzione | Quando | Cosa fa |
|---|---|---|
| `syncOraria` | ogni ora | legge il Calendar da 30 giorni fa a 365 giorni avanti |
| `backupSettimanale` | lunedì ore 4 | copia il database in `BACKUP/`, ne tiene 8 |
| `puliziaNotturna` | ogni notte ore 3 | elimina le sessioni scadute, chiude gli accessi scaduti, pulisce il registro oltre 180 giorni |

## Limiti noti

- Ogni chiamata all'API impiega circa 1-2 secondi (Apps Script): stima da misurare sul campo.
- Massimo 100 email al giorno da Apps Script con account Gmail: bastano perché i codici servono una volta ogni 30 giorni.
- Netlify gratuito: 300 crediti al mese (circa 20 pubblicazioni).
