import Programma from './programma.js';

/**
 * Contenuto del Production Schedule, uguale per la vista sul sito e per il PDF.
 * Funzione pura: dati della scheda + opzioni → testo del documento.
 */
export const TESTI = {
  it: {
    titolo: 'Piano di produzione', evento: 'Evento', eventi: 'Eventi', quando: 'Data e luogo', programma: 'Cronoprogramma',
    colonne: ['Orario', 'Attività', 'Location', 'Responsabile', 'Note'], noteGiorno: 'Note della giornata',
    contatti: 'Contatti', colContatti: ['Ruolo', 'Nome', 'Contatto'], aggiornato: 'Aggiornato il', pagina: 'Pagina', di: 'di',
    vuoto: 'Nessuna attività in programma.', locale: 'it-IT'
  },
  en: {
    titolo: 'Production Schedule', evento: 'Event', eventi: 'Events', quando: 'Date and venue', programma: 'Schedule',
    colonne: ['Time', 'Activity', 'Location', 'Responsible', 'Notes'], noteGiorno: 'Day notes',
    contatti: 'Contacts', colContatti: ['Role', 'Name', 'Contact'], aggiornato: 'Updated', pagina: 'Page', di: 'of',
    vuoto: 'No activities scheduled.', locale: 'en-GB'
  }
};

function data(iso, locale, opts) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { timeZone: 'UTC', ...opts });
}

function intervalloDate(giornate, locale) {
  if (!giornate.length) return '';
  const a = giornate[0].data, b = giornate[giornate.length - 1].data;
  const lungo = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  if (a === b) return data(a, locale, lungo);
  return data(a, locale, { day: 'numeric', month: 'long' }) + ' – ' + data(b, locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * opzioni: { lingua: 'it'|'en', giorno: '' (tutte) | id giornata, contatti: bool, adesso: Date }
 */
export function datiDocumento(prod, opzioni = {}) {
  const T = TESTI[opzioni.lingua] || TESTI.it;
  const spazi = new Map(prod.spazi.map(s => [s.id, s]));
  const giornate = prod.giornate.filter(g => !opzioni.giorno || g.id === opzioni.giorno);
  const venue = prod.spazi.find(s => s.tipo === 'venue') || prod.spazi[0];
  // "Officine Cantelmo" + "Officine Cantelmo, Lecce" → "Officine Cantelmo, Lecce" (niente ripetizioni)
  const luogo = venue ? (venue.indirizzo && venue.indirizzo.toLowerCase().startsWith(venue.nome.toLowerCase()) ? venue.indirizzo
    : [venue.nome, venue.indirizzo].filter(Boolean).join(', '))
    : (prod.eventi[0] && prod.eventi[0].luogo) || '';

  const intestazione = [[T.evento, prod.nome]];
  intestazione.push([T.quando, [intervalloDate(giornate, T.locale), luogo].filter(Boolean).join(' · ')]);
  if (prod.eventi.length > 1) intestazione.push([T.eventi, prod.eventi.map(e => e.titolo).join(' · ')]);

  const giorni = giornate.map(g => {
    const righe = Programma.ordina(prod.attivita.filter(a => a.giornata_id === g.id)).map(a => [
      a.ora_inizio ? (a.ora_fine ? a.ora_inizio + ' – ' + a.ora_fine : a.ora_inizio) : '',
      Programma.nome(a),
      (spazi.get(a.spazio_id) || {}).nome || '',
      a.responsabile || '',
      a.note || ''
    ]);
    const titolo = data(g.data, T.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { id: g.id, titolo: titolo.charAt(0).toUpperCase() + titolo.slice(1) + (g.etichetta ? ' · ' + g.etichetta : ''), righe, note: g.note || '' };
  });

  const contatti = opzioni.contatti ? prod.squadra.filter(m => m.persona).map(m => {
    const p = m.persona;
    return [m.ruolo || p.ruolo || '', p.nome + (p.azienda ? ' (' + p.azienda + ')' : ''), [p.telefono, p.email].filter(Boolean).join(' · ')];
  }) : [];

  const adesso = opzioni.adesso || new Date();
  const aggiornato = T.aggiornato + ' ' + adesso.toLocaleString(T.locale, { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return { T, titolo: T.titolo, intestazione, giorni, contatti, aggiornato };
}

/** Nome del file: "Production Schedule - Bill Frisell Trio - 2026-11-08.pdf" */
export function nomeFile(prod, doc, giornate) {
  const pulito = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const d = giornate.length ? giornate[0].data : '';
  return [pulito(doc.titolo), pulito(prod.nome), d].filter(Boolean).join(' - ') + '.pdf';
}

/**
 * I caratteri fuori dalla codifica dei font standard del PDF (WinAnsi) vengono sostituiti:
 * frecce e simili con un equivalente, il resto con "?" (così il PDF non mostra caratteri rotti).
 */
const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SOSTITUTI = { '→': '->', '←': '<-', '↔': '<->', '≥': '>=', '≤': '<=', '≠': '!=', '×': 'x', ' ': ' ', '\t': ' ', ' ': ' ', ' ': ' ' };
export function testoPdf(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || EXTRA.includes(ch)) out += ch;
    else if (ch in SOSTITUTI) out += SOSTITUTI[ch];
    else if (c >= 0xfe00 && c <= 0xfe0f) continue; // selettori di variante delle emoji
    else out += '?';
  }
  return out;
}
