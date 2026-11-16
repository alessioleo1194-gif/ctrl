import { h, icon } from '../ui.js';
import { store, navigate } from '../app.js';
import { dayParts, monthLabel, today, timeRange, shortDate } from '../format.js';
import { openEventForm } from './eventForm.js';

/** Lista eventi: prossimi o passati, ricerca, raggruppati per mese. */
export function renderList(pane, selectedId) {
  const t = today();
  const listBox = h('div', { role: 'list' });

  function filtered() {
    const q = store.q.trim().toLowerCase();
    let evs = store.events.filter(e => store.filter === 'prossimi' ? (e.data_fine || e.data) >= t : (e.data_fine || e.data) < t);
    if (store.filter === 'passati') evs = evs.slice().reverse();
    if (q) evs = evs.filter(e => (e.titolo + ' ' + (e.luogo || '') + ' ' + (e.descrizione || '')).toLowerCase().includes(q));
    return evs;
  }

  function row(e) {
    const p = dayParts(e.data);
    const isToday = e.data <= t && (e.data_fine || e.data) >= t;
    const multi = e.data_fine && e.data_fine !== e.data ? 'fino al ' + shortDate(e.data_fine) : '';
    const meta = [multi, timeRange(e), e.luogo].filter(Boolean).join(' · ') || (e.origine === 'manuale' ? 'Evento manuale' : '—');
    const ind = h('div', { class: 'ind', 'aria-label': 'Documentazione' },
      icon('piano', 'piano' + (e.stato_doc.piano ? ' on' : ''), e.stato_doc.piano ? 'Piano di produzione presente' : 'Piano di produzione mancante'),
      icon('materiale', 'materiale' + (e.stato_doc.materiale ? ' on' : ''), e.stato_doc.materiale ? 'Lista materiale presente' : 'Lista materiale mancante'),
      icon('scheda', 'scheda' + (e.stato_doc.scheda ? ' on' : ''), e.stato_doc.scheda ? 'Scheda tecnica presente' : 'Scheda tecnica mancante'));
    return h('button', {
      class: 'ev' + (e.stato === 'annullato' ? ' annullato' : '') + ((e.data_fine || e.data) < t ? ' passato' : ''),
      role: 'listitem', 'aria-current': e.id === selectedId ? 'true' : null,
      onclick: () => navigate('#/e/' + e.id)
    },
    h('span', { class: 'bar', style: { background: e.colore } }),
    h('span', { class: 'day' }, h('b', {}, p.day), h('small', {}, p.wd)),
    h('span', { style: { minWidth: 0 } },
      h('div', { class: 't' }, e.titolo),
      h('div', { class: 'm' },
        isToday ? h('span', { class: 'tag today', style: { marginRight: '6px' } }, 'Oggi') : null,
        e.stato === 'annullato' ? h('span', { class: 'tag danger', style: { marginRight: '6px' } }, 'Annullato') : null,
        meta)),
    ind);
  }

  function draw() {
    const evs = filtered();
    if (!evs.length) {
      listBox.replaceChildren(h('div', { class: 'empty' }, store.q ? 'Nessun evento corrisponde alla ricerca.' : store.filter === 'prossimi' ? 'Nessun evento in programma.' : 'Nessun evento passato.'));
      return;
    }
    const out = [];
    let month = '';
    for (const e of evs) {
      const ml = monthLabel(e.data);
      if (ml !== month) { month = ml; out.push(h('div', { class: 'month label' }, ml)); }
      out.push(row(e));
    }
    listBox.replaceChildren(...out);
  }

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Periodo' },
    ...['prossimi', 'passati'].map(f => h('button', { type: 'button', 'aria-pressed': String(store.filter === f), onclick: (ev) => {
      store.filter = f;
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
      draw();
    } }, f === 'prossimi' ? 'Prossimi' : 'Passati')));

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cerca evento o luogo', value: store.q, 'aria-label': 'Cerca', oninput: (e) => { store.q = e.target.value; draw(); } });

  const head = h('div', { class: 'list-head' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      seg,
      store.user.permessi.creareEventi ? h('button', { class: 'btn primary desk-only', onclick: () => openEventForm(null) }, icon('plus'), 'Nuovo evento') : null),
    h('div', { class: 'search' }, icon('search'), search));

  pane.replaceChildren(head, listBox);
  draw();
  const cur = listBox.querySelector('[aria-current="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
