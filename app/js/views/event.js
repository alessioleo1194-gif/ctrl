import { api } from '../api.js';
import { h, icon, toast, loading } from '../ui.js';
import { store, navigate, upsertEvent } from '../app.js';
import { dateRange, timeRange, orarioGiornata, stamp } from '../format.js';
import { openEventForm } from './eventForm.js';
import { allegatiCard } from './allegati.js';
import { staffCard } from './staff.js';
import { giornateCard } from '../giornate.js';
import { nomeTag } from '../persone.js';

/** I campi che arrivano solo da eventi.get: il resto è già nell'elenco e si mostra subito. */
const EXTRA = ['allegati', 'produzione', 'storico'];
const nucleo = (ev) => JSON.stringify(ev, (k, v) => (EXTRA.includes(k) ? undefined : v));

/** Orario dell'evento: se c'è una sola giornata vale quello della giornata (corretto da te se il Calendar sbaglia). */
function orarioEvento(ev) {
  const gg = ev.giorni || [];
  if (gg.length === 1 && (gg[0].ora_inizio || gg[0].ora_fine)) return orarioGiornata(gg[0]);
  return timeRange(ev);
}

let aperture = 0;   // conta le aperture: una risposta in ritardo di un evento già chiuso non deve ridisegnare nulla

/**
 * Dettaglio evento. L'evento compare subito dai dati dell'elenco già in memoria (titolo, giornate, staff, note);
 * documenti, file e storico si riempiono appena arriva la risposta del server, che riallinea anche il resto.
 */
export async function renderEvent(pane, id) {
  const mio = ++aperture;
  pane.dataset.evento = id;
  const noto = store.events && store.events.find(e => e.id === id);
  if (noto) draw(pane, noto);
  else pane.replaceChildren(loading('Apertura evento…'));
  let ev;
  try {
    ev = await api('eventi.get', { id });
  } catch (e) {
    if (mio !== aperture) return;
    pane.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'banner' }, e.code === 'NOT_FOUND' ? 'Evento non trovato: potrebbe essere stato archiviato.' : e.message),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Torna agli eventi'))));
    return;
  }
  if (mio !== aperture) return;
  const eraNoto = noto && noto.versione === ev.versione && nucleo(noto) === nucleo(ev);
  upsertEvent(ev);
  if (!noto || !eraNoto) {
    // qualcosa è cambiato rispetto all'elenco: si ridisegna tutto, a meno che si stia già scrivendo una nota
    if (!modificheInCorso(pane)) { draw(pane, ev); return; }
  }
  riempiExtra(pane, ev);
}

/** C'è testo scritto e non ancora salvato in questa pagina? Allora non si ridisegna sotto le mani di chi scrive. */
function modificheInCorso(pane) {
  return [...pane.querySelectorAll('textarea, input')].some(el => el.value !== (el.defaultValue ?? el.value));
}

/** Sostituisce i riquadri che dipendono dai dati completi (documenti, file, storico) senza toccare il resto. */
function riempiExtra(pane, ev) {
  const p = store.user.permessi;
  const sostituisci = (nome, nuovo) => {
    const vecchio = pane.querySelector('[data-slot="' + nome + '"]');
    if (!vecchio) return;
    if (nuovo) vecchio.replaceWith(nuovo); else vecchio.remove();
  };
  const bloccato = ev.accesso === false;
  if (!bloccato) {
    sostituisci('produzione', produzioneCard(ev, p));
    sostituisci('allegati', allegatiCard(ev));
  }
  sostituisci('storico', storicoCard(ev, p));
}

function draw(pane, ev, extra) {
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
      orarioEvento(ev) ? h('span', { class: 'mono' }, orarioEvento(ev)) : null,
      ev.luogo ? h('span', {}, ev.luogo) : null));

  const mapsUrl = ev.luogo ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.luogo) : null;
  const corr = ev.correzioni || {};
  const daCal = ev.origine === 'calendar';
  const chiama = async (campo, scelta) => {
    try { const upd = await api('eventi.calendario', { id: ev.id, campo, scelta }); upsertEvent(upd); draw(pane, upd); toast(scelta === 'usa' ? 'Torna il dato del Calendar' : 'Tengo il tuo dato'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const NOMI = { titolo: 'Titolo', data: 'Data', data_fine: 'Fine', luogo: 'Luogo', descrizione: 'Descrizione' };
  const mostra = (v) => v || '—';
  /** Sotto un dato corretto a mano: cosa diceva il Calendar, e se nel frattempo è cambiato, la scelta. */
  const nota = (...campi) => {
    const mod = campi.filter(k => corr[k]);
    if (!mod.length) return null;
    const diff = mod.filter(k => corr[k].nuovo !== null);
    return h('div', { class: 'corr' },
      h('span', { class: 'tag warn' }, 'Modificato da te'),
      h('span', { class: 'help' }, mod.map(k => (campi.length > 1 ? NOMI[k] + ' ' : '') + 'Calendar: ' + mostra(corr[k].calendario)).join(' · ')),
      p.creareEventi ? h('button', { class: 'btn sm', type: 'button', onclick: () => Promise.all(mod.map(k => api('eventi.calendario', { id: ev.id, campo: k, scelta: 'usa' }).then(upd => (ev = upd)))).then(() => { upsertEvent(ev); draw(pane, ev); toast('Torna il dato del Calendar'); }).catch(e => toast(e.message, 'err')) }, 'Ripristina Calendar') : null,
      diff.map(k => h('div', { class: 'alert-lv lv-arancio' },
        h('div', {}, h('b', {}, 'Il Calendar è cambiato. '), NOMI[k] + ': ora dice «', h('b', {}, mostra(corr[k].nuovo)), '»; tu hai «', h('b', {}, mostra(ev[k])), '».'),
        p.creareEventi ? h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => chiama(k, 'tieni') }, 'Tieni il mio'),
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => chiama(k, 'usa') }, 'Usa quello del Calendar')) : null)));
  };
  const info = h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Informazioni'),
      p.creareEventi ? h('button', { class: 'btn', onclick: () => openEventForm(ev, (upd) => draw(pane, upd)) }, icon('edit'), 'Modifica') : null),
    h('div', { class: 'in' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Titolo'), h('dd', {}, ev.titolo, nota('titolo')),
        h('dt', {}, 'Data'), h('dd', {}, dateRange(ev), nota('data', 'data_fine')),
        h('dt', {}, 'Orario'), h('dd', { class: 'mono' }, orarioEvento(ev) || 'Tutto il giorno'),
        h('dt', {}, 'Luogo'), h('dd', {}, ev.luogo ? h('a', { href: mapsUrl, target: '_blank', rel: 'noopener' }, ev.luogo) : '—', nota('luogo')),
        h('dt', {}, 'Descrizione'), h('dd', { class: 'pre' }, ev.descrizione || '—', nota('descrizione')),
        p.admin ? null : [h('dt', {}, 'Staff'), h('dd', {}, (ev.staff || []).length ? h('div', { class: 'names', style: { marginTop: 0 } }, ev.staff.map(nomeTag)) : '—')],
        daCal ? [h('dt', {}, 'Fonte'), h('dd', { class: 'help' }, 'Arriva dal Google Calendar, che CTRL legge soltanto. Titolo, data, luogo e descrizione si correggono con Modifica, gli orari nella giornata: le tue correzioni restano anche quando il Calendar si aggiorna, e se il Calendar cambia lo stesso dato ti viene segnalato.')] : null)));

  // chi non è nello staff vede l'evento ma non documenti, file e note
  const bloccato = ev.accesso === false;
  const staff = p.admin ? staffCard(ev, (upd, x) => draw(pane, upd, x), extra && extra.staff) : null;
  const giornate = giornateCard(ev, (upd, x) => draw(pane, upd, x));
  const notes = bloccato ? null : notesCard(ev, p, (upd) => draw(pane, upd));
  const produzione = bloccato ? bloccatoCard() : produzioneCard(ev, p);
  const allegati = bloccato ? null : allegatiCard(ev);
  const histo = storicoCard(ev, p);

  const admin = p.admin ? adminCard(ev, pane) : null;

  pane.replaceChildren(head, h('div', { class: 'detail-body' }, info, giornate, staff, produzione, allegati, notes, admin, histo));
}

/** Ultime modifiche (solo Owner). Finché i dati completi non arrivano il posto resta segnato con un riquadro vuoto. */
function storicoCard(ev, p) {
  if (!p.admin) return null;
  if (!ev.storico) return h('section', { class: 'card skel', 'data-slot': 'storico', 'aria-hidden': 'true' }, h('header', {}, h('span', { class: 'label' }, 'Ultime modifiche')));
  if (!ev.storico.length) return h('span', { 'data-slot': 'storico', hidden: true });
  return h('section', { class: 'card', 'data-slot': 'storico' },
    h('header', {}, h('span', { class: 'label' }, 'Ultime modifiche')),
    h('div', { class: 'in histo' }, ev.storico.map(s => h('div', {},
      h('span', { class: 'mono help' }, stamp(s.ts)),
      h('span', {}, h('b', {}, s.email === 'calendar' ? 'Calendar' : s.email), ' · ', s.azione, s.dopo ? h('span', { class: 'help' }, ' ' + s.dopo.slice(0, 140)) : null)))));
}

/** Al posto di documenti, file e note per chi non è assegnato all'evento. */
function bloccatoCard() {
  return h('section', { class: 'card prod-card', id: 'riservato' },
    h('header', {}, h('span', { class: 'label' }, 'Documenti di produzione'), h('span', { class: 'tag' }, 'Riservato')),
    h('div', { class: 'in', style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'lock-box' }, h('span', { class: 'ic' }, icon('lock')),
        h('div', {}, h('b', {}, 'Non sei nello staff di questo evento.'),
          h('p', { class: 'help', style: { margin: '2px 0 0', fontSize: '13px' } }, 'Production Plan, Material List, schede tecniche, rider e note sono visibili solo a chi è assegnato. Per essere aggiunto chiedilo a chi gestisce CTRL.'))),
      h('div', { class: 'doc-btns' },
        h('span', { class: 'doc-btn off' }, h('span', { class: 'doc-ico piano' }, icon('piano')), h('span', { class: 'doc-btn-t' }, h('b', {}, 'Production Plan'), h('span', { class: 'help' }, 'Bloccato'))),
        h('span', { class: 'doc-btn off' }, h('span', { class: 'doc-ico materiale' }, icon('materiale')), h('span', { class: 'doc-btn-t' }, h('b', {}, 'Material List'), h('span', { class: 'help' }, 'Bloccato'))))));
}

/**
 * Riquadro dei documenti operativi: Production Plan e Material List si aprono direttamente come fogli.
 * La produzione (che raggruppa gli eventi di un festival) si crea da sola alla prima apertura.
 */
function produzioneCard(ev, p) {
  // chi non può modificare non vede né crea Plan e Material List: legge e scarica i file allegati
  if (!p.modificare) return null;
  // finché i dati completi non sono arrivati si conosce solo l'id della produzione (dall'elenco): i pulsanti funzionano già
  const inCaricamento = ev.produzione === undefined;
  const pr = inCaricamento ? (ev.produzione_id ? { id: ev.produzione_id, tipo: '', eventi: [], documenti: {} } : null) : ev.produzione;
  const status = h('div', { class: 'status-line' });
  const info = (tipo) => {
    if (inCaricamento && pr) return '…';
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
        const x = store.events?.find(y => y.id === ev.id); if (x) { x.produzione_id = nuova.id; x.produzione = undefined; }
        navigate('#/p/' + nuova.id + '/' + tipo);
      } catch (err) { status.className = 'status-line err'; status.textContent = err.message; b.disabled = false; }
    } }, corpo);
  };
  return h('section', { class: 'card prod-card', 'data-slot': 'produzione' },
    h('header', {}, h('span', { class: 'label' }, pr && pr.tipo === 'festival' ? 'Documenti di produzione · festival' : 'Documenti di produzione')),
    h('div', { class: 'in', style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'doc-btns' }, apri('plan', 'Production Plan', 'piano', 'piano'), apri('materiali', 'Material List', 'materiale', 'materiale')),
      pr && pr.eventi.length > 1 ? h('p', { class: 'help', style: { margin: 0 } }, 'Condivisi con: ' + pr.eventi.filter(e => e.id !== ev.id).map(e => e.titolo).join(' · ')) : null,
      pr && !inCaricamento && p.modificare ? festivalMenu(ev, pr) : null,
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
        if (nuova.eventi.some(z => z.id === y.id)) { y.produzione_id = nuova.id; y.produzione = undefined; } else if (y.produzione_id === nuova.id) { y.produzione_id = ''; y.produzione = undefined; }
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
