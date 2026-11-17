import { api } from '../api.js';
import { h, toast, loading } from '../ui.js';
import { upsertEvent, refreshList } from '../app.js';
import { iniziali } from '../persone.js';

const ORIGINE = { calendario: 'da calendario', manuale: 'manuale' };
const RUOLO = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };

/** Riga di testo con il termine trovato evidenziato. */
function evidenzia(testo, termine) {
  const i = termine ? testo.toLowerCase().indexOf(termine.toLowerCase()) : -1;
  if (i < 0) return [testo];
  return [testo.slice(0, i), h('mark', {}, testo.slice(i, i + termine.length)), testo.slice(i + termine.length)];
}

/**
 * Scheda "Staff" dell'evento (solo Owner): assegnati, proposte trovate nella descrizione del Calendar,
 * aggiunta manuale. Nessuna proposta vale finché non viene confermata.
 */
export function staffCard(ev) {
  const card = h('section', { class: 'card', id: 'staff' }, h('header', {}, h('span', { class: 'label' }, 'Staff')), h('div', { class: 'in' }, loading('Staff…')));
  let busy = false;

  async function carica() {
    try { disegna(await api('staff.evento', { evento_id: ev.id })); }
    catch (e) { card.replaceChildren(h('header', {}, h('span', { class: 'label' }, 'Staff')), h('div', { class: 'in' }, h('div', { class: 'banner' }, e.message))); }
  }

  /** La lista eventi riflette subito nomi e badge senza ricaricare tutto. */
  async function aggiornaLista() {
    try { upsertEvent(await api('eventi.get', { id: ev.id })); refreshList(); } catch { /* la lista si aggiorna alla prossima apertura */ }
  }

  async function agisci(azione, email) {
    if (busy) return;
    busy = true;
    try {
      disegna(await api('staff.gestisci', { evento_id: ev.id, azione, email }));
      aggiornaLista();
    } catch (e) { toast(e.message, 'err'); }
    busy = false;
  }

  const persona = (a, azioni) => h('span', { class: 'persona pc-' + a.colore },
    h('span', { class: 'av' }, iniziali(a.nome)), a.nome, h('small', {}, [RUOLO[a.ruolo] || a.ruolo, ORIGINE[a.origine]].filter(Boolean).join(' · ')), azioni);

  function disegna(s) {
    const proposte = s.proposte.map(p => h('div', { class: 'staff-prop', 'data-email': p.email },
      h('span', { class: 'av pc-' + p.colore }, iniziali(p.nome)),
      h('div', { class: 't' }, h('b', {}, p.nome), ' · ' + (RUOLO[p.ruolo] || p.ruolo),
        h('small', {}, 'Trovato nella descrizione: «', evidenzia(p.trovato, p.termine), '»')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => agisci('conferma', p.email) }, 'Conferma'),
      h('button', { class: 'btn', type: 'button', onclick: () => agisci('scarta', p.email) }, 'Non è lui')));

    const sel = h('select', { class: 'input', 'aria-label': 'Aggiungi staff', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) agisci('aggiungi', v); } },
      h('option', { value: '' }, 'Aggiungi manualmente…'),
      s.candidati.map(c => h('option', { value: c.email }, c.nome + ' · ' + (RUOLO[c.ruolo] || c.ruolo))));

    card.replaceChildren(
      h('header', {}, h('span', { class: 'label' }, 'Staff'),
        h('span', { class: 'tag' }, s.assegnati.length === 1 ? '1 assegnato' : s.assegnati.length + ' assegnati'),
        h('span', { class: 'help', style: { marginLeft: 'auto' } }, 'Solo l\'Owner assegna')),
      h('div', { class: 'in', style: { display: 'grid', gap: '12px' } },
        s.assegnati.length
          ? h('div', { class: 'staff-chips' }, s.assegnati.map(a => persona(a, h('button', { type: 'button', 'aria-label': 'Togli ' + a.nome + ' dallo staff', title: 'Togli dallo staff', onclick: () => agisci('rimuovi', a.email) }, '×'))))
          : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuno assegnato: chi non è nello staff vede l\'evento ma non documenti, file e note.'),
        proposte,
        s.scartate.length ? h('div', { class: 'staff-scartate' }, 'Scartati:', s.scartate.map(a => h('span', {}, a.nome + ' ',
          h('button', { class: 'btn sm', type: 'button', onclick: () => agisci('ripristina', a.email) }, 'Ripristina')))) : null,
        h('div', { class: 'staff-add' }, sel, h('span', { class: 'help' }, 'Le assegnazioni confermate o manuali non cambiano quando il calendario cambia.'))));
  }

  carica();
  return card;
}
