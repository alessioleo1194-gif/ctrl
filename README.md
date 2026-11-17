# CTRL

Centro di comando della produzione eventi: elenco eventi dal Google Calendar, piani di produzione,
liste materiale, schede tecniche e condivisione con la squadra. Funziona da computer, tablet e telefono (installabile come app).

| Documento | Contenuto |
|---|---|
| [docs/INSTALLAZIONE.md](docs/INSTALLAZIONE.md) | Messa in funzione passo passo (Apps Script, Netlify) |
| [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md) | Come è fatto, sicurezza, dati, limiti |
| [docs/MANUTENZIONE.md](docs/MANUTENZIONE.md) | Chiedere modifiche, verificare, tornare indietro |
| [CLAUDE.md](CLAUDE.md) | Regole per chi sviluppa |
| [CHANGELOG.md](CHANGELOG.md) | Storico delle versioni |

## Struttura

```
app/              app web (pubblicata da Netlify)
backend/src/      server Apps Script, sorgenti
backend/dist/     Codice.gs: file unico da incollare in Apps Script (generato)
tests/            test automatici (backend con Google simulato, app nel browser)
scripts/          build del backend e server locale
```

## Comandi

```
npm install          # una volta
npm run build        # rigenera backend/dist/Codice.gs
npm test             # tutti i test
npm run serve        # app in locale su http://localhost:4173
```

## Stato

In produzione su https://ctrl-leo.netlify.app (finché il sito Netlify non è rinominato: https://ctrl-alessioleo.netlify.app).
Fase 1 (fondamenta): accesso, ruoli, eventi dal Calendar e manuali, note di produzione, impostazioni, app installabile.
Scheda di produzione (in costruzione a tappe): programma (Production Schedule) con PDF e stampa, struttura, persone e squadra; file allegati su Drive. Prossime tappe: lista materiali per location, artisti e channel list, materiale calcolato dai rider.
Librerie dell'app copiate in `app/vendor` con versione bloccata: jsPDF 4.2.1, jspdf-autotable 5.0.9 (licenze MIT in `app/vendor/LICENSES.txt`).
Prossime fasi: PDF completo (F3), link di condivisione (F4),
pagina madre e festival (F5), consultazione offline (F6).
