import { h, icon } from '../ui.js';
import { store, navigate } from '../app.js';
import { dayParts, monthLabel, today, timeRange, shortDate, orarioGiornata, giornoLungo } from '../format.js';
import { openEventForm } from './eventForm.js';
import { staffNomi } from '../persone.js';

/** Lista eventi: prossimi o passati, ricerca, raggruppati per mese. */
export function renderList(pane, selectedId) {
  const t = today();
  let selId = selectedId;
  const listBox = h('div', { role: 'list' });

  function filtered() {
    const q = store.q.trim().toLowerCase();
    let evs = store.events.filter(e => store.filter === 'prossimi' ? (e.data_fine || e.data) >= t : (e.data_fine || e.data) < t);
    if (store.filter === 'passati') evs = evs.slice().reverse();
    if (store.mine) evs = evs.filter(e => e.mio);
    if (q) evs = evs.filter(e => (e.titolo + ' ' + (e.luogo || '') + ' ' + (e.descrizione || '') + ' ' + (e.staff || []).map(x => x.nome).join(' ')).toLowerCase().includes(q));
    return evs;
  }

  /** Un evento su più giorni compare una volta per giornata, sotto la sua data. */
  function righe(evs) {
    const out = [];
    for (const e of evs) {
      const gg = e.giorni && e.giorni.length ? e.giorni : [null];
      for (const g of gg) out.push({ e, g, data: g ? g.data : e.data });
    }
    const dir = store.filter === 'passati' ? -1 : 1;
    out.sort((a, b) => dir * ((a.data + (a.g?.ora_inizio || a.e.ora_inizio || '99:99') + a.e.titolo).localeCompare(b.data + (b.g?.ora_inizio || b.e.ora_inizio || '99:99') + b.e.titolo)));
    return out;
  }

  function row(e, g) {
    const multiGiorno = !!(g && g.di > 1);
    const p = dayParts(g ? g.data : e.data);
    const isToday = g ? g.data === t : (e.data <= t && (e.data_fine || e.data) >= t);
    const orario = g ? (g.ora_inizio || g.ora_fine ? orarioGiornata(g) : '') : timeRange(e);
    const multi = !g && e.data_fine && e.data_fine !== e.data ? 'fino al ' + shortDate(e.data_fine) : '';
    const meta = [multi, orario, e.luogo].filter(Boolean).join(' · ') || (e.origine === 'manuale' ? 'Evento manuale' : '—');
    const sovrapposto = !!(g && g.staff && g.staff.some(x => x.livello === 'sovrapposizione'));
    const ind = h('div', { class: 'ind', 'aria-label': 'Documentazione' },
      icon('piano', 'piano' + (e.stato_doc.piano ? ' on' : ''), e.stato_doc.piano ? 'Piano di produzione presente' : 'Piano di produzione mancante'),
      icon('materiale', 'materiale' + (e.stato_doc.materiale ? ' on' : ''), e.stato_doc.materiale ? 'Lista materiale presente' : 'Lista materiale mancante'),
      icon('scheda', 'scheda' + (e.stato_doc.scheda ? ' on' : ''), e.stato_doc.scheda ? 'Scheda tecnica presente' : 'Scheda tecnica mancante'));
    const finito = (g ? g.data : (e.data_fine || e.data)) < t;
    const staff = g && g.staff ? g.staff : (e.staff || []);
    // Load-in e Load-out dal Production Plan: sempre in vista nel riquadro
    const pl = g && g.plan ? g.plan : null;
    const loadInOut = pl && (pl.load_in || pl.load_out)
      ? h('div', { class: 'lo', 'aria-label': 'Orari del piano di produzione' },
        pl.load_in ? h('span', { class: 'lo-i', 'data-k': 'load-in' }, h('small', {}, 'Load-in'), h('b', {}, pl.load_in)) : null,
        pl.load_out ? h('span', { class: 'lo-o', 'data-k': 'load-out' }, h('small', {}, 'Load-out'), h('b', {}, pl.load_out)) : null)
      : null;
    const nomi = staff.length || e.da_confermare || !finito
      ? h('div', { class: 'names', 'aria-label': 'Staff' },
        staffNomi(staff),
        !staff.length && !finito ? h('span', { class: 'help' }, 'nessuno staff') : null,
        e.da_confermare ? h('span', { class: 'tag warn', title: 'Nomi trovati nella descrizione, da confermare nell\'evento' }, e.da_confermare + ' da confermare') : null)
      : null;
    return h('button', {
      class: 'ev' + (e.stato === 'annullato' ? ' annullato' : '') + (finito ? ' passato' : ''),
      role: 'listitem', 'aria-current': e.id === selId ? 'true' : null, 'data-id': e.id, 'data-giorno': g ? g.data : null,
      onclick: () => navigate('#/e/' + e.id)
    },
    h('span', { class: 'bar', style: { background: e.colore } }),
    h('span', { class: 'day' }, h('b', {}, p.day), h('small', {}, p.wd)),
    h('span', { style: { minWidth: 0 } },
      h('div', { class: 't' }, e.titolo),
      h('div', { class: 'm' },
        isToday ? h('span', { class: 'tag today', style: { marginRight: '6px' } }, 'Oggi') : null,
        multiGiorno ? h('span', { class: 'gg' }, 'Giorno ' + g.n + ' di ' + g.di) : null,
        sovrapposto ? h('span', { class: 'lv lv-rosso', style: { marginRight: '6px' }, title: 'Una persona ha un altro impegno che si sovrappone in questa giornata' }, '⚠ Sovrapposizione') : null,
        e.stato === 'annullato' ? h('span', { class: 'tag danger', style: { marginRight: '6px' } }, 'Annullato') : null,
        meta),
      loadInOut,
      nomi),
    ind);
  }

  function draw() {
    const evs = filtered();
    if (!evs.length) {
      listBox.replaceChildren(h('div', { class: 'empty' }, store.q ? 'Nessun evento corrisponde alla ricerca.' : !store.user.permessi.vedereEventi ? (store.filter === 'prossimi' ? 'Non sei assegnato a nessun evento in programma.' : 'Nessun evento passato a cui sei stato assegnato.') : store.mine ? 'Non sei assegnato a nessun evento in questo elenco.' : store.filter === 'prossimi' ? 'Nessun evento in programma.' : 'Nessun evento passato.'));
      return;
    }
    const out = [];
    let month = '', giorno = '';
    const rr = righe(evs);
    const perGiorno = {};
    rr.forEach(r => { perGiorno[r.data] = (perGiorno[r.data] || 0) + 1; });
    for (const r of rr) {
      const ml = monthLabel(r.data);
      if (ml !== month) { month = ml; out.push(h('div', { class: 'month label' }, ml)); }
      // una striscia colorata a ogni cambio di giorno: si vede subito dove finisce una giornata e inizia l'altra
      if (r.data !== giorno) {
        giorno = r.data;
        const n = perGiorno[r.data];
        out.push(h('div', { class: 'dsep' + (r.data === t ? ' oggi' : r.data < t ? ' passato' : ''), 'data-data': r.data, role: 'presentation' },
          h('span', { class: 'dsep-d' }, giornoLungo(r.data)),
          r.data === t ? h('span', { class: 'dsep-t' }, 'Oggi') : null,
          h('span', { class: 'dsep-n' }, n === 1 ? '1 evento' : n + ' eventi')));
      }
      out.push(row(r.e, r.g));
    }
    listBox.replaceChildren(...out);
  }

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo' },
    ...['prossimi', 'passati'].map(f => h('button', { type: 'button', 'aria-pressed': String(store.filter === f), onclick: (ev) => {
      store.filter = f;
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
      draw();
    } }, f === 'prossimi' ? 'Prossimi' : 'Passati')));

  // la ricerca ridisegna la lista una volta sola quando ci si ferma un istante, non a ogni lettera
  let attesa = 0;
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cerca evento o luogo', value: store.q, 'aria-label': 'Cerca', oninput: (e) => {
    store.q = e.target.value;
    clearTimeout(attesa);
    attesa = setTimeout(draw, 90);
  } });

  const mine = h('button', { class: 'chip-t', type: 'button', 'aria-pressed': String(!!store.mine), title: 'Mostra solo gli eventi a cui sei assegnato', onclick: (ev) => {
    store.mine = !store.mine;
    ev.currentTarget.setAttribute('aria-pressed', String(store.mine));
    draw();
  } }, 'Solo i miei');

  const head = h('div', { class: 'list-head' },
    h('div', { class: 'list-tools' },
      seg, store.user.permessi.vedereEventi ? mine : null, h('span', { class: 'grow' }),
      store.user.permessi.creareEventi ? h('button', { class: 'btn primary desk-only', onclick: () => openEventForm(null) }, icon('plus'), 'Nuovo evento') : null),
    h('div', { class: 'search' }, icon('search'), search));

  pane.replaceChildren(head, listBox);
  draw();
  // agganci per cambiare selezione o ridisegnare le righe senza ricostruire la lista (e senza perdere ricerca e scorrimento)
  pane.seleziona = (id) => { selId = id; marca(); };
  pane.ridisegna = () => { clearTimeout(attesa); draw(); };
  function marca() {
    listBox.querySelectorAll('[aria-current]').forEach(el => el.removeAttribute('aria-current'));
    if (!selId) return;
    listBox.querySelectorAll('.ev').forEach(el => { if (el.dataset.id === selId) el.setAttribute('aria-current', 'true'); });
  }
  const cur = listBox.querySelector('[aria-current="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

/** Evidenzia nella lista l'evento aperto, senza ridisegnarla. */
export function segnaSelezionato(pane, id) {
  if (pane.seleziona) pane.seleziona(id || null);
}
