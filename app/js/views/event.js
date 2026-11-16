import { api } from '../api.js';
import { h, icon, toast, loading } from '../ui.js';
import { store, navigate, upsertEvent } from '../app.js';
import { dateRange, timeRange, stamp } from '../format.js';
import { openEventForm } from './eventForm.js';
import { sectionCard, ORDINE } from './sections.js';

/** Dettaglio evento: informazioni, piano, materiale, scheda tecnica, note. */
export async function renderEvent(pane, id) {
  pane.replaceChildren(loading('Apertura evento…'));
  let ev;
  try {
    ev = await api('eventi.get', { id });
  } catch (e) {
    pane.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'banner' }, e.code === 'NOT_FOUND' ? 'Evento non trovato: potrebbe essere stato archiviato.' : e.message),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Torna agli eventi'))));
    return;
  }
  draw(pane, ev);
}

function draw(pane, ev) {
  const p = store.user.permessi;
  const back = h('a', { class: 'btn ghost mob-only', href: '#/', style: { marginLeft: '-12px', paddingLeft: '8px' } }, icon('back'), 'Eventi');

  const head = h('header', { class: 'detail-head', style: { '--ev-color': ev.colore } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', minHeight: '28px' } }, back, h('span', { class: 'desk-spacer' }),
      h('div', { class: 'row' },
        ev.stato === 'annullato' ? h('span', { class: 'tag danger' }, 'Annullato sul Calendar') : null,
        ev.stato === 'archiviato' ? h('span', { class: 'tag' }, 'Archiviato') : null,
        h('span', { class: 'tag' }, ev.origine === 'calendar' ? 'Google Calendar' : 'Manuale'))),
    h('h1', {}, ev.titolo),
    h('div', { class: 'detail-meta' },
      h('span', {}, dateRange(ev)),
      timeRange(ev) ? h('span', { class: 'mono' }, timeRange(ev)) : null,
      ev.luogo ? h('span', {}, ev.luogo) : null));

  const mapsUrl = ev.luogo ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.luogo) : null;
  const info = h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Informazioni'),
      p.creareEventi && ev.origine === 'manuale' ? h('button', { class: 'btn', onclick: () => openEventForm(ev, (upd) => draw(pane, upd)) }, icon('edit'), 'Modifica') : null),
    h('div', { class: 'in' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Data'), h('dd', {}, dateRange(ev)),
        h('dt', {}, 'Orario'), h('dd', { class: 'mono' }, timeRange(ev) || 'Tutto il giorno'),
        h('dt', {}, 'Luogo'), h('dd', {}, ev.luogo ? h('a', { href: mapsUrl, target: '_blank', rel: 'noopener' }, ev.luogo) : '—'),
        h('dt', {}, 'Descrizione'), h('dd', { class: 'pre' }, ev.descrizione || '—'),
        ev.origine === 'calendar' ? [h('dt', {}, 'Fonte'), h('dd', { class: 'help' }, 'Titolo, date, orari, luogo e descrizione si modificano dal Google Calendar e si aggiornano qui ogni ora.')] : null)));

  const notes = notesCard(ev, p, (upd) => draw(pane, upd));

  const sezioni = ORDINE.map(k => sectionCard(ev, k));

  const admin = p.admin ? adminCard(ev, pane) : null;
  const histo = p.admin && ev.storico?.length ? h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Ultime modifiche')),
    h('div', { class: 'in histo' }, ev.storico.map(s => h('div', {},
      h('span', { class: 'mono help' }, stamp(s.ts)),
      h('span', {}, h('b', {}, s.email === 'calendar' ? 'Calendar' : s.email), ' · ', s.azione, s.dopo ? h('span', { class: 'help' }, ' ' + s.dopo.slice(0, 140)) : null))))) : null;

  pane.replaceChildren(head, h('div', { class: 'detail-body' }, info, ...sezioni, notes, admin, histo));
}

function notesCard(ev, p, redraw) {
  const status = h('div', { class: 'status-line' });
  if (!p.modificare) {
    return h('section', { class: 'card' }, h('header', {}, h('span', { class: 'label' }, 'Note di produzione')),
      h('div', { class: 'in pre' }, ev.note || h('span', { class: 'help' }, 'Nessuna nota.')));
  }
  const ta = h('textarea', { class: 'input', 'aria-label': 'Note di produzione', placeholder: 'Indicazioni per la squadra: accessi, parcheggio, referenti, orari di carico…' }, ev.note || '');
  const btn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    btn.disabled = true; status.className = 'status-line'; status.textContent = 'Salvataggio…';
    try {
      const upd = await api('eventi.update', { id: ev.id, versione: ev.versione, note: ta.value });
      upsertEvent(upd);
      toast('Note salvate');
      redraw(upd);
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.code === 'CONFLICT' ? 'Qualcun altro ha modificato questo evento. Copia il tuo testo e ricarica la pagina.' : e.message;
      btn.disabled = false;
    }
  } }, 'Salva note');
  ta.addEventListener('input', () => { btn.disabled = ta.value === (ev.note || ''); status.textContent = btn.disabled ? '' : 'Modifiche non salvate'; status.className = 'status-line'; });
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Note di produzione'), btn),
    h('div', { class: 'in', style: { display: 'grid', gap: '8px' } }, ta, status));
}

function adminCard(ev, pane) {
  const setStato = async (stato, btn) => {
    btn.disabled = true;
    try {
      const upd = await api('eventi.stato', { id: ev.id, versione: ev.versione, stato });
      upsertEvent(upd);
      toast(stato === 'archiviato' ? 'Evento archiviato' : 'Evento ripristinato');
      if (stato === 'archiviato') navigate('#/'); else draw(pane, upd);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
  let confirmArm = false;
  const archBtn = h('button', { class: 'btn danger', onclick: (e) => {
    if (!confirmArm) { confirmArm = true; e.currentTarget.textContent = 'Conferma archiviazione'; setTimeout(() => { confirmArm = false; archBtn.textContent = 'Archivia evento'; }, 4000); return; }
    setStato('archiviato', e.currentTarget);
  } }, 'Archivia evento');
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Amministrazione')),
    h('div', { class: 'in row' },
      ev.stato === 'archiviato'
        ? h('button', { class: 'btn', onclick: (e) => setStato('attivo', e.currentTarget) }, 'Ripristina evento')
        : archBtn,
      ev.cartella_url ? h('a', { class: 'btn', href: ev.cartella_url, target: '_blank', rel: 'noopener' }, icon('folder'), 'Cartella Drive') : null,
      h('span', { class: 'help' }, 'Archiviare toglie l\'evento dalla lista senza cancellare nulla.')));
}
