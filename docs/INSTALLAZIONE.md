# CTRL · Installazione

Da fare una sola volta. Servono circa 20 minuti, dal computer.
Al termine CTRL ha due server (produzione e test) e un sito su Netlify che si aggiorna da solo.

Le cartelle su Drive sono già pronte:

```
CTRL/
  CTRL · DATABASE        ← dati veri
  EVENTI/  FESTIVAL/  BACKUP/
  _TEST/
    CTRL · DATABASE TEST ← dati di prova
    EVENTI/  FESTIVAL/  BACKUP/
```

---

## Parte 1 · Server di produzione (Apps Script "CTRL API")

1. Apri **script.google.com** con il tuo account Google (lo stesso che possiede la cartella Drive `CTRL`) e premi **Nuovo progetto**.
2. In alto clicca su "Progetto senza titolo" e rinominalo **CTRL API**.
3. Icona a ingranaggio **Impostazioni progetto** → spunta **Mostra il file manifest "appsscript.json" nell'editor**.
4. Torna all'editor (icona `< >`), apri **appsscript.json**, cancella tutto e incolla il contenuto di
   [`backend/appsscript.json`](../backend/appsscript.json). Salva (icona del dischetto).
5. Apri **Codice.gs**, cancella tutto e incolla il contenuto di [`backend/dist/Codice.gs`](../backend/dist/Codice.gs)
   (su GitHub: apri il file → pulsante **Copy raw file**). Salva.
6. Nel menu a tendina accanto a **Esegui** scegli **setupProduzione** e premi **Esegui**.
   - Compare "Autorizzazione necessaria" → **Rivedi autorizzazioni** → scegli il tuo account.
   - Se compare "Google non ha verificato questa app" → **Avanzate** → **Vai a CTRL API (non sicuro)** → **Consenti**.
     È normale: l'app è tua e la usi solo tu come proprietario.
   - Nel registro in basso deve comparire **"Prima sincronizzazione: {...}"** con il numero di eventi letti.
7. **Esegui il deployment** → **Nuovo deployment** → ingranaggio accanto a "Seleziona il tipo" → **Applicazione web**:
   - Descrizione: `CTRL v0.1.0`
   - Esegui come: **Me**
   - Chi ha accesso: **Chiunque**
   - Premi **Esegui il deployment** e copia l'**URL dell'applicazione web** (finisce con `/exec`).

> **Perché "Chiunque"?** L'app su Netlify deve poter chiamare il server senza un login Google.
> I dati restano protetti: ogni richiesta, tranne "invia codice", richiede l'accesso a CTRL con codice via email,
> e lo script controlla il ruolo di chi chiede. Foglio e cartelle non vengono condivisi con nessuno.

## Parte 2 · Server di test ("CTRL API TEST")

Ripeti la Parte 1 con queste differenze:

- nome del progetto **CTRL API TEST**;
- al punto 6 esegui **setupTest** (non setupProduzione);
- copia anche questo URL `/exec`.

Il test legge lo stesso calendario ma scrive solo nel database di test.

## Parte 3 · Sito su Netlify

1. Apri **app.netlify.com** → **Add new project** → **Import an existing project** → **GitHub**.
2. Autorizza Netlify se te lo chiede e scegli il repository **ctrl**.
3. Lascia i campi come li propone (li legge da `netlify.toml`): branch `main`, nessun comando di build,
   cartella di pubblicazione `app`. Premi **Deploy**.
4. **Project configuration** → **Change project name** → ad esempio `ctrl-produzione`.
   L'indirizzo diventa `https://ctrl-produzione.netlify.app`.

## Parte 4 · Collegamento (lo faccio io)

Mandami:

1. URL `/exec` di **CTRL API**
2. URL `/exec` di **CTRL API TEST**
3. indirizzo del sito Netlify

Io aggiorno `app/js/config.js`, apro una pull request e Netlify crea l'anteprima.
Dopo la tua verifica la unisco e il sito di produzione è operativo.

## Verifica finale

- Apri il sito dal telefono → inserisci la tua email → arriva un'email "CTRL · codice di accesso" → inserisci il codice.
- Vedi gli eventi di "CoolClub PRODUZIONE".
- Da Chrome/Safari: **Aggiungi a schermata Home** per installarla come app.
