import { api } from './api.js';
import { unisciDocumento } from './unisci.js';

/**
 * Salvataggio del documento aperto: sempre per intero, con la versione che ho letto.
 * - Le modifiche partono dopo una breve pausa (o subito con "Save Changes").
 * - Se nel frattempo qualcun altro ha salvato, il server risponde con la sua versione e le due
 *   si uniscono riga per riga (unisci.js); l'unione torna alla schermata tramite onRemoto.
 * - Se la rete cade si riprova con attese crescenti senza perdere nulla; un errore di validazione si ferma e si segnala.
 */
const RITENTI = [2000, 5000, 10000, 20000, 30000];

export function creaSalvataggio({ produzioneId, tipo, versione, dati, prendiDati, onStato, onRemoto, attesa = 1200 }) {
  let ver = String(versione || '0');
  let base = JSON.parse(JSON.stringify(dati || null));
  let sporco = false, inVolo = false, timer = null, tentativo = 0, fermo = null, ultimo = '';
  let attesaFine = [];

  const stato = () => {
    if (fermo) return { tipo: 'errore', testo: fermo };
    if (inVolo) return { tipo: 'salvataggio', testo: 'Salvataggio…' };
    if (sporco) return { tipo: tentativo ? 'attesa' : 'modifiche', testo: tentativo ? 'Rete assente, riprovo…' : 'Modifiche non salvate' };
    return { tipo: 'ok', testo: ultimo ? 'Salvato alle ' + ultimo : 'Tutto salvato' };
  };
  const avvisa = () => onStato && onStato(stato());
  const programma = (ms) => { clearTimeout(timer); timer = setTimeout(invia, ms); };
  const fine = () => { const a = attesaFine; attesaFine = []; a.forEach(f => f()); };

  function modificato() {
    if (fermo) fermo = null; // l'utente ha cambiato qualcosa: si riprova
    sporco = true; tentativo = 0;
    programma(attesa); avvisa();
  }

  async function invia() {
    clearTimeout(timer);
    if (inVolo) return;
    if (!sporco) return fine();
    const mio = JSON.parse(JSON.stringify(prendiDati()));
    inVolo = true; avvisa();
    try {
      const r = await api('documento.salva', { produzione_id: produzioneId, tipo, versione: ver, dati: mio });
      inVolo = false;
      tentativo = 0;
      if (r.conflitto) {
        const unito = unisciDocumento(tipo, base, mio, r.dati);
        ver = r.versione; base = r.dati;
        onRemoto && onRemoto(unito, r);
        programma(0);                       // rinvia l'unione sopra la versione del server
        avvisa();
        return;
      }
      ver = r.versione; base = mio;
      ultimo = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      // modifiche arrivate mentre salvavo: nuovo invio
      sporco = JSON.stringify(prendiDati()) !== JSON.stringify(mio);
      if (sporco) programma(300);
    } catch (e) {
      inVolo = false;
      if (!e.code || e.code === 'NETWORK' || e.code === 'BUSY' || (e.code === 'SERVER' && tentativo < 3)) {
        programma(RITENTI[Math.min(tentativo, RITENTI.length - 1)]);
        tentativo++;
      } else fermo = 'Non salvato: ' + e.message;
    }
    avvisa();
    if (!sporco && !fermo) fine();
  }

  /** Salva adesso; si risolve quando tutto è sul server (o dopo un errore). */
  function subito() {
    if (!sporco && !inVolo) return Promise.resolve();
    return new Promise((ok) => { attesaFine.push(ok); if (!inVolo) invia(); if (fermo) fine(); });
  }

  return { modificato, subito, stato, inSospeso: () => sporco || inVolo, fermo: () => fermo, versione: () => ver };
}
