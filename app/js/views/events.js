import { h, icon } from '../ui.js';
import { store, navigate } from '../app.js';
import { dayParts, monthLabel, today, timeRange, shortDate } from '../format.js';
import { openEventForm } from './eventForm.js';
import { staffNomi } from '../persone.js';

/** Lista eventi: prossimi o passati, ricerca, raggruppati per mese. */
export function renderList(pane, selectedId) {
  const t = today();
  const listBox = h('div', { role: 'list' });

  function filtered() {
    const q = store.q.trim().toLowerCase();
    let evs = store.events.filter(e => store.filter === 'prossimi' ? (e.data_fine || e.data) >= t : (e.data_fine || e.data) < t);
    if (store.filter === 'passati') evs = evs.slice().reverse();
    if (store.mine) evs = evs.filter(e => e.mio);
    if (q) evs = evs.filter(e => (e.titolo + ' ' + (e.luogo || '') + ' ' + (e.descrizione || '') + ' ' + (e.staff || []).map(x => x.nome).join(' ')).toLowerCase().includes(q));
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
    const finito = (e.data_fine || e.data) < t;
    const staff = e.staff || [];
    const nomi = staff.length || e.da_confermare || !finito
      ? h('div', { class: 'names', 'aria-label': 'Staff' },
        staffNomi(staff),
        !staff.length && !finito ? h('span', { class: 'help' }, 'nessuno staff') : null,
        e.da_confermare ? h('span', { class: 'tag warn', title: 'Nomi trovati nella descrizione, da confermare nell\'evento' }, e.da_confermare + ' da confermare') : null)
      : null;
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
        meta),
      nomi),
    ind);
  }

  function draw() {
    const evs = filtered();
    if (!evs.length) {
      listBox.replaceChildren(h('div', { class: 'empty' }, store.q ? 'Nessun evento corrisponde alla ricerca.' : store.mine ? 'Non sei assegnato a nessun evento in questo elenco.' : store.filter === 'prossimi' ? 'Nessun evento in programma.' : 'Nessun evento passato.'));
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

  const mine = h('button', { class: 'chip-t', type: 'button', 'aria-pressed': String(!!store.mine), title: 'Mostra solo gli eventi a cui sei assegnato', onclick: (ev) => {
    store.mine = !store.mine;
    ev.currentTarget.setAttribute('aria-pressed', String(store.mine));
    draw();
  } }, 'Solo i miei');

  const head = h('div', { class: 'list-head' },
    h('div', { class: 'list-tools' },
      seg, mine, h('span', { class: 'grow' }),
      store.user.permessi.creareEventi ? h('button', { class: 'btn primary desk-only', onclick: () => openEventForm(null) }, icon('plus'), 'Nuovo evento') : null),
    h('div', { class: 'search' }, icon('search'), search));

  pane.replaceChildren(head, listBox);
  draw();
  const cur = listBox.querySelector('[aria-current="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
