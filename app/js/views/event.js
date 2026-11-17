import { api } from '../api.js';
import { h, icon, toast, loading } from '../ui.js';
import { store, navigate, upsertEvent } from '../app.js';
import { dateRange, timeRange, stamp } from '../format.js';
import { openEventForm } from './eventForm.js';
import { allegatiCard } from './allegati.js';

/** Dettaglio evento: informazioni, scheda di produzione, file allegati, note. */
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

  const produzione = produzioneCard(ev, p);
  const allegati = allegatiCard(ev);

  const admin = p.admin ? adminCard(ev, pane) : null;
  const histo = p.admin && ev.storico?.length ? h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Ultime modifiche')),
    h('div', { class: 'in histo' }, ev.storico.map(s => h('div', {},
      h('span', { class: 'mono help' }, stamp(s.ts)),
      h('span', {}, h('b', {}, s.email === 'calendar' ? 'Calendar' : s.email), ' · ', s.azione, s.dopo ? h('span', { class: 'help' }, ' ' + s.dopo.slice(0, 140)) : null))))) : null;

  pane.replaceChildren(head, h('div', { class: 'detail-body' }, info, produzione, allegati, notes, admin, histo));
}

/**
 * Riquadro dei documenti operativi: Production Plan e Material List si aprono direttamente come fogli.
 * La produzione (che raggruppa gli eventi di un festival) si crea da sola alla prima apertura.
 */
function produzioneCard(ev, p) {
  const pr = ev.produzione;
  const status = h('div', { class: 'status-line' });
  const info = (tipo) => {
    const d = pr && pr.documenti && pr.documenti[tipo];
    return d ? 'Compilato · modificato ' + stamp(d.aggiornato_il) : 'Da compilare';
  };
  const apri = (tipo, nome, ico, cls) => {
    const corpo = [h('span', { class: 'doc-ico ' + cls }, icon(ico)), h('span', { class: 'doc-btn-t' }, h('b', {}, nome), h('span', { class: 'help' }, info(tipo)))];
    if (pr) return h('a', { class: 'doc-btn', href: '#/p/' + pr.id + '/' + tipo }, corpo);
    if (!p.modificare) return h('span', { class: 'doc-btn off' }, corpo);
    return h('button', { class: 'doc-btn', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const nuova = await api('produzione.assicura', { evento_id: ev.id });
        const x = store.events?.find(y => y.id === ev.id); if (x) x.produzione_id = nuova.id;
        navigate('#/p/' + nuova.id + '/' + tipo);
      } catch (err) { status.className = 'status-line err'; status.textContent = err.message; b.disabled = false; }
    } }, corpo);
  };
  return h('section', { class: 'card prod-card' },
    h('header', {}, h('span', { class: 'label' }, pr && pr.tipo === 'festival' ? 'Documenti di produzione · festival' : 'Documenti di produzione')),
    h('div', { class: 'in', style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'doc-btns' }, apri('plan', 'Production Plan', 'piano', 'piano'), apri('materiali', 'Material List', 'materiale', 'materiale')),
      pr && pr.eventi.length > 1 ? h('p', { class: 'help', style: { margin: 0 } }, 'Condivisi con: ' + pr.eventi.filter(e => e.id !== ev.id).map(e => e.titolo).join(' · ')) : null,
      pr && p.modificare ? festivalMenu(ev, pr) : null,
      status));
}

/** Festival: più eventi del Calendar condividono lo stesso Production Plan e la stessa Material List. */
function festivalMenu(ev, pr) {
  const corpo = h('div', { class: 'festival-corpo' });
  const det = h('details', { class: 'festival' }, h('summary', {}, 'Festival: condividi con altri eventi'), corpo);
  det.addEventListener('toggle', () => { if (det.open) disegna(); });
  async function agisci(fn) {
    try {
      const nuova = await fn();
      if (store.events) store.events.forEach(y => {
        if (nuova.eventi.some(z => z.id === y.id)) y.produzione_id = nuova.id; else if (y.produzione_id === nuova.id) y.produzione_id = '';
      });
      const pane = det.closest('.pane-detail');
      if (pane) renderEvent(pane, ev.id);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function disegna() {
    corpo.replaceChildren(loading('…'));
    let eventi = store.events;
    try { eventi = eventi || await api('eventi.list', {}); } catch (e) { corpo.replaceChildren(h('p', { class: 'help' }, e.message)); return; }
    const liberi = eventi.filter(x => !x.produzione_id && x.id !== ev.id);
    corpo.replaceChildren(
      h('div', { class: 'ev-linked' }, pr.eventi.map(x => h('div', { class: 'ev-link' },
        h('span', {}, h('b', {}, x.titolo), h('span', { class: 'help' }, ' · ' + x.data)),
        pr.eventi.length > 1 ? h('button', { class: 'btn ghost', onclick: () => agisci(() => api('produzione.scollega', { id: pr.id, evento_id: x.id })) }, 'Scollega') : null))),
      liberi.length ? h('select', { class: 'input', 'aria-label': 'Collega un altro evento', onchange: (e) => { if (e.target.value) agisci(() => api('produzione.collega', { id: pr.id, evento_id: e.target.value })); } },
        h('option', { value: '' }, 'Collega un altro evento…'), liberi.slice(0, 200).map(x => h('option', { value: x.id }, x.data + ' · ' + x.titolo))) : h('p', { class: 'help' }, 'Nessun altro evento libero da collegare.'));
  }
  return det;
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
