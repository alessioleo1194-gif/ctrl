import { minutiInizio } from './orari.js';

/**
 * Contenuto dei documenti (Production Plan, Material List), uguale per anteprima, PDF e testo copiato.
 * Funzioni pure: dati salvati + dati dell'evento → struttura del documento.
 */
export const TESTI = {
  en: {
    plan: 'Production Plan', materiali: 'Material List', evento: 'Event', data: 'Date', venue: 'Location / Venue', indirizzo: 'Address',
    crew: 'Technical Crew', colCrew: ['Name', 'Role', 'Phone', 'Email'], schedule: 'Production Schedule',
    colSchedule: ['Time', 'Activity', 'Location', 'Details / Notes'], colMateriali: ['Item', 'Qty', 'Notes'],
    aggiornato: 'Updated', pagina: 'Page', di: 'of', giorno: 'Day', vuoto: 'Nothing scheduled.', vuotoM: 'No items.', locale: 'en-GB'
  },
  it: {
    plan: 'Piano di produzione', materiali: 'Lista materiale', evento: 'Evento', data: 'Data', venue: 'Location / Venue', indirizzo: 'Indirizzo',
    crew: 'Crew tecnica', colCrew: ['Nome', 'Ruolo', 'Telefono', 'Email'], schedule: 'Cronoprogramma',
    colSchedule: ['Orario', 'Attività', 'Location', 'Dettagli / Note'], colMateriali: ['Voce', 'Q.tà', 'Note'],
    aggiornato: 'Aggiornato il', pagina: 'Pagina', di: 'di', giorno: 'Giorno', vuoto: 'Nessuna attività in programma.', vuotoM: 'Nessuna voce.', locale: 'it-IT'
  }
};

const SEZIONE_INIZIALE = 'Pre Show';

function dataLunga(iso, locale, opts) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { timeZone: 'UTC', ...opts });
}

export function intervalloDate(eventi, locale) {
  const date = eventi.flatMap(e => [e.data, e.data_fine || e.data]).filter(Boolean).sort();
  if (!date.length) return '';
  const a = date[0], b = date[date.length - 1];
  if (a === b) return dataLunga(a, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return dataLunga(a, locale, { day: 'numeric', month: 'long' }) + ' – ' + dataLunga(b, locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Venue = prima parte del luogo del Calendar; indirizzo = il resto. */
export function luogoEvento(eventi) {
  const l = (eventi.find(e => e.luogo) || {}).luogo || '';
  const parti = l.split(',').map(s => s.trim()).filter(Boolean);
  return { venue: parti[0] || '', indirizzo: parti.slice(1).join(', ') };
}

/** Sezione di ogni riga: quella scritta, altrimenti quella della riga sopra ("Pre Show" all'inizio). */
export function sezioniEffettive(righe) {
  let cur = SEZIONE_INIZIALE;
  return righe.map(r => { if ((r.sez || '').trim()) cur = r.sez.trim(); return cur; });
}

export const rigaUsata = (r) => !!((r.att || '').trim() || (r.loc || '').trim() || (r.note || '').trim());

/** Righe usate, ordinate per orario dentro ogni sezione; le sezioni nell'ordine in cui compaiono nel foglio. */
export function sezioniOrdinate(righe) {
  const eff = sezioniEffettive(righe);
  const ordine = [], gruppi = new Map();
  righe.forEach((r, i) => {
    if (!rigaUsata(r)) return;
    const s = eff[i];
    if (!gruppi.has(s)) { gruppi.set(s, []); ordine.push(s); }
    gruppi.get(s).push({ r, i });
  });
  return ordine.map(nome => ({
    nome,
    righe: gruppi.get(nome).sort((a, b) => {
      const x = minutiInizio(a.r.ora), y = minutiInizio(b.r.ora);
      if (x === null && y === null) return a.i - b.i;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y || a.i - b.i;
    }).map(x => x.r)
  }));
}

/** Ordina le righe del foglio per orario, tenendo ferma la sezione di ognuna (la scrive esplicitamente). */
export function ordinaFoglio(righe) {
  const eff = sezioniEffettive(righe);
  const ordine = [];
  eff.forEach(s => { if (!ordine.includes(s)) ordine.push(s); });
  const con = righe.map((r, i) => ({ r: { ...r, sez: eff[i] }, i, s: eff[i] }));
  con.sort((a, b) => {
    const sa = ordine.indexOf(a.s), sb = ordine.indexOf(b.s);
    if (sa !== sb) return sa - sb;
    const x = minutiInizio(a.r.ora), y = minutiInizio(b.r.ora);
    if (x === null && y === null) return a.i - b.i;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y || a.i - b.i;
  });
  // la sezione si scrive solo sulla prima riga di ogni gruppo (le altre la ereditano)
  let prec = null;
  return con.map(({ r, s }) => { const nuova = { ...r, sez: s === prec ? '' : s }; prec = s; return nuova; });
}

function adesso(opz, T) {
  const d = opz.adesso || new Date();
  return T.aggiornato + ' ' + d.toLocaleString(T.locale, { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function intestazione(prod, eventi, T) {
  const { venue, indirizzo } = luogoEvento(eventi);
  const out = [[T.evento, prod.nome], [T.data, intervalloDate(eventi, T.locale)], [T.venue, venue]];
  if (indirizzo) out.push([T.indirizzo, indirizzo]);
  return out.filter(([, v]) => v);
}

export function costruisciPlan(prod, eventi, dati, opz = {}) {
  const T = TESTI[dati.lingua] || TESTI.en;
  const crew = dati.crew.filter(c => c.nome || c.ruolo || c.telefono || c.email).map(c => [c.nome, c.ruolo, c.telefono, c.email]);
  let giorni = dati.giorni.map(g => ({ g, sezioni: sezioniOrdinate(g.righe) }));
  const conAttivita = giorni.filter(x => x.sezioni.length);
  giorni = conAttivita.length ? conAttivita : giorni.slice(0, 1);
  const multi = dati.giorni.length > 1;
  return {
    tipo: 'plan', T, titolo: T.plan, intestazione: intestazione(prod, eventi, T), nomeEvento: prod.nome,
    crewTitolo: T.crew, colCrew: T.colCrew, crew,
    scheduleTitolo: T.schedule, colSchedule: T.colSchedule,
    giorni: giorni.map(({ g, sezioni }) => ({
      titolo: multi && g.data ? (dataLunga(g.data, T.locale, { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase())) : '',
      sezioni: sezioni.map(s => ({ nome: s.nome, righe: s.righe.map(r => [r.ora, r.att, r.loc, r.note]) }))
    })),
    aggiornato: adesso(opz, T), data: (dati.giorni[0] || {}).data || ''
  };
}

export function costruisciMateriali(prod, eventi, dati, opz = {}) {
  const T = TESTI[opz.lingua] || TESTI.en;
  const sezioni = dati.sezioni.map(s => ({
    nome: s.nome || '—',
    righe: s.righe.filter(r => r.voce || r.qta || r.note).map(r => [r.voce, r.qta, r.note])
  })).filter(s => s.righe.length);
  return {
    tipo: 'materiali', T, titolo: T.materiali, intestazione: intestazione(prod, eventi, T), nomeEvento: prod.nome,
    colonne: T.colMateriali, sezioni, aggiornato: adesso(opz, T),
    data: eventi.map(e => e.data).filter(Boolean).sort()[0] || ''
  };
}

/** Testo semplice da incollare in un messaggio. */
export function testoDocumento(d) {
  const L = [d.titolo.toUpperCase()];
  d.intestazione.forEach(([k, v]) => L.push(`${k}: ${v}`));
  L.push('');
  if (d.tipo === 'plan') {
    if (d.crew.length) {
      L.push(d.crewTitolo.toUpperCase());
      d.crew.forEach(r => L.push(r.filter(Boolean).join(' · ')));
      L.push('');
    }
    L.push(d.scheduleTitolo.toUpperCase());
    d.giorni.forEach(g => {
      if (g.titolo) L.push('', g.titolo);
      if (!g.sezioni.length) L.push(d.T.vuoto);
      g.sezioni.forEach(s => {
        L.push('', '— ' + s.nome.toUpperCase());
        s.righe.forEach(([ora, att, loc, note]) => L.push([ora, att, loc ? '(' + loc + ')' : '', note ? '– ' + note : ''].filter(Boolean).join(' ')));
      });
    });
  } else {
    if (!d.sezioni.length) L.push(d.T.vuotoM);
    d.sezioni.forEach(s => {
      L.push(s.nome.toUpperCase());
      s.righe.forEach(([voce, qta, note]) => { L.push('- ' + (qta ? qta + '  ' : '') + voce + (note ? ' (' + note + ')' : '')); });
      L.push('');
    });
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Nome del file: "Production Plan - Bill Frisell Trio - 2026-11-08.pdf" */
export function nomeFile(d) {
  const pulito = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return [pulito(d.titolo), pulito(d.nomeEvento), d.data].filter(Boolean).join(' - ') + '.pdf';
}

/**
 * I caratteri fuori dalla codifica dei font standard del PDF (WinAnsi) vengono sostituiti:
 * frecce e simili con un equivalente, il resto con "?" (così il PDF non mostra caratteri rotti).
 */
const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SOSTITUTI = { '→': '->', '←': '<-', '↔': '<->', '≥': '>=', '≤': '<=', '≠': '!=', '×': 'x', '\t': ' ', ' ': ' ', ' ': ' ' };
export function testoPdf(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || EXTRA.includes(ch)) out += ch;
    else if (ch in SOSTITUTI) out += SOSTITUTI[ch];
    else if (c >= 0xfe00 && c <= 0xfe0f) continue;
    else out += '?';
  }
  return out;
}
