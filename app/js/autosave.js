import { api } from './api.js';

/**
 * Salvataggio automatico della scheda di produzione.
 *
 * - Le modifiche si accodano e partono dopo una breve pausa, raggruppate in un solo invio.
 * - Più modifiche allo stesso elemento si fondono (crea + modifica = crea con i campi aggiornati;
 *   crea + elimina prima dell'invio = niente).
 * - Un invio alla volta. Se la rete cade, si ritenta con attese crescenti senza perdere nulla
 *   (il server ignora i doppioni: gli id li genera l'app).
 * - Un errore di validazione ferma il salvataggio e lo segnala: non si riprova all'infinito.
 */
const RITENTI = [2000, 5000, 10000, 20000, 30000];

export function nuovoId(prefisso) {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return prefisso + '_' + Array.from(a, b => (b % 36).toString(36)).join('');
}

export function creaSalvataggio({ id, onStato, onRisposta, attesa = 900 }) {
  let coda = new Map();   // chiave tipo:id -> operazione
  let inVolo = null;      // operazioni in invio
  let timer = null;
  let tentativo = 0;
  let fermo = null;       // errore che blocca il salvataggio
  let ultimoSalvataggio = null;

  function chiave(op) { return op.tipo + ':' + (op.id || '') }

  function stato() {
    if (fermo) return { tipo: 'errore', testo: fermo };
    if (inVolo) return { tipo: 'salvataggio', testo: 'Salvataggio…' };
    if (coda.size) return tentativo ? { tipo: 'attesa', testo: 'Rete assente, riprovo…' } : { tipo: 'modifiche', testo: 'Modifiche in corso…' };
    if (ultimoSalvataggio) return { tipo: 'ok', testo: 'Salvato alle ' + ultimoSalvataggio };
    return { tipo: 'ok', testo: 'Tutto salvato' };
  }
  const avvisa = () => onStato && onStato(stato());

  /** Accoda una modifica: { tipo, azione, id, campi, versione }. */
  function metti(op) {
    if (fermo) return;
    const k = chiave(op);
    const prima = coda.get(k);
    if (!prima) coda.set(k, { ...op, campi: { ...(op.campi || {}) } });
    else if (op.azione === 'elimina') {
      if (prima.azione === 'crea') coda.delete(k); else coda.set(k, { ...op, campi: {} });
    } else {
      prima.campi = { ...prima.campi, ...(op.campi || {}) };
      if (prima.azione !== 'crea') prima.versione = prima.versione || op.versione;
    }
    programma(attesa);
    avvisa();
  }

  function programma(ms) {
    clearTimeout(timer);
    timer = setTimeout(invia, ms);
  }

  async function invia() {
    if (inVolo || fermo || !coda.size) return;
    inVolo = [...coda.values()];
    coda = new Map();
    avvisa();
    try {
      const r = await api('produzione.salva', { id, ops: inVolo });
      tentativo = 0;
      ultimoSalvataggio = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      inVolo = null;
      onRisposta && onRisposta(r);
    } catch (e) {
      // un errore interno del server che si ripete non va ritentato all'infinito
      const daRiprovare = !e.code || e.code === 'NETWORK' || e.code === 'BUSY' || (e.code === 'SERVER' && tentativo < 3);
      if (daRiprovare) {
        // rimette in testa le operazioni non salvate, senza perdere quelle arrivate nel frattempo
        const dopo = coda;
        coda = new Map();
        inVolo.forEach(op => coda.set(chiave(op), op));
        dopo.forEach((op, k) => {
          const p = coda.get(k);
          if (!p) coda.set(k, op);
          else if (op.azione === 'elimina') { if (p.azione === 'crea') coda.delete(k); else coda.set(k, op); }
          else p.campi = { ...p.campi, ...op.campi };
        });
        inVolo = null;
        programma(RITENTI[Math.min(tentativo, RITENTI.length - 1)]);
        tentativo++;
      } else {
        inVolo = null;
        fermo = 'Non salvato: ' + e.message;
      }
    }
    avvisa();
    if (coda.size && !inVolo && !fermo && !tentativo) programma(150);
  }

  /** Invia subito ciò che è in coda (es. prima di cambiare pagina). */
  function subito() {
    clearTimeout(timer);
    return invia();
  }

  return {
    metti, subito, stato,
    inSospeso: () => coda.size > 0 || !!inVolo,
    fermo: () => fermo
  };
}
