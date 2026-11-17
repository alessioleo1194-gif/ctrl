import { h } from '../ui.js';
import { creaGriglia } from '../grid.js';
import { nuovoId } from '../ids.js';
import { normalizzaTempo } from '../orari.js';
import { costruisciPlan, intervalloDate, luogoEvento, sezioniEffettive, ordinaFoglio, rigaUsata, TESTI } from '../documento-dati.js';
import { apriFoglio } from './foglio.js';

const MEZZ_ORE = Array.from({ length: 49 }, (_, i) => String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'));
const ORA_DEFAULT = '08:00';

export function renderPlan(main, produzioneId) { return apriFoglio(main, produzioneId, 'plan', { crea }); }

const vuotaRiga = (ora = '') => ({ id: nuovoId('r'), sez: '', ora, att: '', loc: '', note: '' });
/** Righe già pronte: 00:00 … 24:00 ogni mezz'ora, con id fissi così due persone non duplicano la base. */
const righeBase = () => MEZZ_ORE.map(o => ({ ...vuotaRiga(o), id: 'r' + o.replace(':', '') }));

function dateEventi(eventi) {
  const out = new Set();
  eventi.forEach(e => {
    let d = e.data; const fine = e.data_fine || e.data;
    for (let i = 0; d && d <= fine && i < 31; i++) { out.add(d); d = new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); }
  });
  return [...out].sort();
}

function crea(r, modifica) {
  const prod = r.produzione, eventi = r.eventi;
  const dati = r.dati || { lingua: 'en', crew: [], giorni: [] };
  // una giornata per ogni data degli eventi; quelle già scritte restano comunque
  dateEventi(eventi).forEach(d => { if (!dati.giorni.some(g => g.data === d)) dati.giorni.push({ id: 'g' + d.replace(/-/g, ''), data: d, righe: righeBase() }); });
  if (!dati.giorni.length) dati.giorni.push({ id: 'g1', data: '', righe: righeBase() });
  dati.giorni.sort((a, b) => (a.data || '~').localeCompare(b.data || '~'));
  dati.giorni.forEach(g => { if (!g.righe.length) g.righe = righeBase(); });

  let giornoId = dati.giorni[0].id;
  let notifica = () => {};
  let griglie = [];
  let radice = null;

  const suggerimenti = r.suggerimenti || [];
  const catalogo = r.catalogo_attivita || [];

  const unici = (valori) => { const v = new Set(); return valori.filter(x => { const k = x.toLowerCase(); if (!x || v.has(k)) return false; v.add(k); return true; }); };
  const giorno = () => dati.giorni.find(g => g.id === giornoId) || dati.giorni[0];
  const tutteRighe = () => dati.giorni.flatMap(g => g.righe);

  // ---- crew ----
  const crewRighe = dati.crew.map(c => ({ ...c }));
  const nuovaCrew = () => ({ id: nuovoId('c'), nome: '', ruolo: '', telefono: '', email: '' });
  const crewGriglia = creaGriglia({
    etichetta: 'Crew', righe: crewRighe, nuovaRiga: nuovaCrew, autoCresci: true, minimoRighe: 8, solaLettura: !modifica, maxRighe: 100,
    vuota: (x) => !x.nome && !x.ruolo && !x.telefono && !x.email,
    colonne: [
      { chiave: 'nome', titolo: 'Name', opzioni: () => {
        const usati = new Set(crewRighe.map(x => x.nome.toLowerCase()));
        return suggerimenti.filter(s => !usati.has(s.nome.toLowerCase())).map(s => ({ valore: s.nome, dettaglio: s.ruolo, extra: s }));
      } },
      { chiave: 'ruolo', titolo: 'Role' },
      { chiave: 'telefono', titolo: 'Phone', modo: 'tel' },
      { chiave: 'email', titolo: 'Email', modo: 'email' }
    ],
    onScelta: (riga, chiave, o) => { ['ruolo', 'telefono', 'email'].forEach(k => { if (!riga[k] && o.extra) riga[k] = o.extra[k] || ''; }); },
    onModifica: () => notifica()
  });

  // ---- programma ----
  let programma = null;
  function disegnaProgramma() {
    if (programma) programma.distruggi();
    const g = giorno();
    programma = creaGriglia({
      etichetta: 'Schedule', righe: g.righe, nuovaRiga: () => vuotaRiga(), solaLettura: !modifica, maxRighe: 400,
      vuota: (x) => !x.sez && !x.ora && !x.att && !x.loc && !x.note,
      colonne: [
        { chiave: 'sez', titolo: 'Section', classe: 'c-sez',
          opzioni: (riga) => unici(['Pre Show', 'Show', ...tutteRighe().filter(x => x !== riga).map(x => x.sez)]),
          segnaposto: (riga, i) => sezioniEffettive(g.righe)[i] },
        { chiave: 'ora', titolo: 'Time', classe: 'c-ora', normalizza: normalizzaTempo, modo: 'text' },
        { chiave: 'att', titolo: 'Activity', classe: 'c-att', opzioni: (riga) => unici([...catalogo, ...tutteRighe().filter(x => x !== riga).map(x => x.att)]) },
        { chiave: 'loc', titolo: 'Location', classe: 'c-loc', opzioni: (riga) => unici(tutteRighe().filter(x => x !== riga).map(x => x.loc)) },
        { chiave: 'note', titolo: 'Details / Notes', classe: 'c-note' }
      ],
      onCella: (riga, chiave) => { if (chiave === 'sez') programma.aggiorna(); },
      onModifica: () => { mostraShow(); programma.aggiorna(); notifica(); }
    });
    programma.el.classList.add('programma');
    return programma.el;
  }
  /** "Show Start" scritto su una riga senza sezione la porta nella sezione Show (anche se incollato). */
  function mostraShow() {
    const g = giorno();
    g.righe.forEach((riga, i) => {
      if ((riga.att || '').trim().toLowerCase() !== 'show start' || (riga.sez || '').trim()) return;
      if (sezioniEffettive(g.righe)[i].toLowerCase() !== 'show') riga.sez = 'Show';
    });
  }

  // ---- struttura della pagina ----
  const segmenti = h('div', { class: 'giorni', role: 'tablist', 'aria-label': 'Giorni' });
  const areaProgramma = h('div', { class: 'programma-area' });
  function disegnaGiorni() {
    segmenti.replaceChildren(...(dati.giorni.length > 1 ? dati.giorni.map(g => {
      const usate = g.righe.filter(rigaUsata).length;
      const b = h('button', { class: 'seg-b', role: 'tab', 'aria-selected': g.id === giorno().id, onclick: () => { giornoId = g.id; disegnaGiorni(); mostraProgramma(); } },
        g.data ? g.data.split('-').reverse().slice(0, 2).join('/') : 'Day', usate ? h('span', { class: 'n' }, usate) : null);
      return b;
    }) : []));
    segmenti.hidden = dati.giorni.length < 2;
  }
  function mostraProgramma() {
    areaProgramma.replaceChildren(disegnaProgramma());
    scorriAllUsata();
  }
  function scorriAllUsata() {
    requestAnimationFrame(() => {
      const g = giorno();
      let i = g.righe.findIndex(rigaUsata);
      if (i < 0) i = Math.max(0, g.righe.findIndex(x => x.ora === ORA_DEFAULT));
      const riga = areaProgramma.querySelector(`tbody tr[data-r="${i}"]`);
      const cont = areaProgramma.querySelector('.griglia');
      if (riga && cont && i > 2) cont.scrollTop = Math.max(0, riga.offsetTop - 40);   // solo dentro il foglio: la pagina resta in alto
    });
  }

  const T = () => TESTI[dati.lingua] || TESTI.en;
  const info = () => {
    const { venue, indirizzo } = luogoEvento(eventi);
    return h('dl', { class: 'intestazione' },
      voce('Event', prod.nome), voce('Date', intervalloDate(eventi, T().locale)), voce('Location / Venue', venue), voce('Address', indirizzo));
  };
  const voce = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v || h('span', { class: 'help' }, '—')));

  const ordina = h('button', { class: 'btn', disabled: !modifica, title: 'Mette le righe in ordine di orario dentro ogni sezione', onclick: () => {
    const g = giorno();
    g.righe.splice(0, g.righe.length, ...ordinaFoglio(g.righe));
    programma.ridisegna(); notifica();
  } }, 'Sort by time');

  function corpo() {
    disegnaGiorni();
    radice = h('div', { class: 'foglio' },
      h('section', { class: 'card' }, h('div', { class: 'in' }, info(), h('p', { class: 'help' }, 'Dati presi dall\'evento nel Calendar: si cambiano lì.'))),
      h('section', { class: 'card' }, h('header', {}, h('span', { class: 'label' }, 'Technical Crew')), h('div', { class: 'in sfoglio' }, crewGriglia.el)),
      h('section', { class: 'card' },
        h('header', {}, h('span', { class: 'label' }, 'Production Schedule'), ordina),
        h('div', { class: 'in sfoglio' }, segmenti, areaProgramma,
          modifica ? h('p', { class: 'help guida' }, 'Scrivi direttamente nelle celle. Incolla da Excel. Tab/Invio per spostarti, Ctrl+Invio inserisce una riga, Ctrl+Canc la elimina, Ctrl+Z annulla. Orari: 1645 oppure 1645-1830.') : null)));
    mostraProgramma();
    return radice;
  }

  return {
    dati: () => ({
      lingua: dati.lingua,
      crew: crewRighe.filter(x => x.nome || x.ruolo || x.telefono || x.email),
      giorni: dati.giorni
    }),
    corpo, aggancia: (f) => { notifica = f; },
    strumenti: () => [],
    lingua: () => dati.lingua,
    impostaLingua: (lg) => { dati.lingua = lg; notifica(); },
    costruisci: (lg) => costruisciPlan(prod, eventi, { ...dati, lingua: lg, crew: crewRighe, giorni: dati.giorni }),
    ricarica: (unito) => {
      dati.lingua = unito.lingua;
      crewRighe.splice(0, crewRighe.length, ...unito.crew.map(c => ({ ...c })));
      dati.giorni.splice(0, dati.giorni.length, ...unito.giorni);
      if (!dati.giorni.some(g => g.id === giornoId)) giornoId = dati.giorni[0].id;
      crewGriglia.aggiorna(); crewGriglia.ridisegna();
      disegnaGiorni(); mostraProgramma();
    },
    distruggi: () => { crewGriglia.distruggi(); if (programma) programma.distruggi(); }
  };
}
