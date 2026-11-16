# CTRL · Manutenzione

## Chiedere una modifica

In una chat del Progetto "PRODUZIONE EVENTI" scrivi cosa vuoi, per esempio:
"CTRL: aggiungi la colonna Fornitore alla lista materiale". Claude lavora sul repository `ctrl`, su un ramo separato,
e apre una pull request con la spiegazione.

## Verificare prima della pubblicazione

1. Su GitHub, nella pull request, i controlli automatici ("Verifiche") devono essere verdi.
2. Netlify aggiunge un commento con il link **Deploy Preview**: aprilo dal telefono. Usa il server di **test**
   (badge TEST in alto), quindi puoi provare senza toccare i dati veri.
3. Se va bene, rispondi "ok": la pull request viene unita e Netlify pubblica in automatico.
4. Se la modifica tocca il server (`backend/`), dopo l'unione aggiorni Apps Script:
   apri **CTRL API** → incolla il nuovo `backend/dist/Codice.gs` → Salva →
   **Esegui il deployment → Gestisci deployment → matita → Versione: Nuova versione → Esegui il deployment**.
   L'indirizzo `/exec` resta lo stesso. Fai lo stesso su **CTRL API TEST** prima di provare l'anteprima.

## Tornare indietro

| Cosa | Come |
|---|---|
| Sito | Netlify → Deploys → scegli una versione precedente → **Publish deploy** (immediato). Se serve, **Lock to stop auto publishing** finché non si corregge |
| Codice | GitHub → pull request unita → **Revert**: crea una modifica che annulla la precedente, tracciata |
| Server | Apps Script → Gestisci deployment → matita → scegli una **Versione** precedente → Esegui il deployment |
| Dati | `CTRL/BACKUP` contiene le ultime 8 copie settimanali. Il foglio ha anche la sua cronologia versioni (File → Cronologia versioni). Lo storico interno di CTRL registra chi ha cambiato cosa |

## Controllo periodico (ogni 3 mesi)

- Netlify: crediti usati nel mese.
- Apps Script → Esecuzioni: errori ripetuti della sincronizzazione.
- GitHub → Security: eventuali avvisi.
- Utenti: disattivare chi non collabora più.
