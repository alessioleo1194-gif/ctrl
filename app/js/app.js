import { api, session, setAuthLostHandler, ApiError } from './api.js';
import { environment, apiUrl } from './config.js';
import { h, icon, toast, loading } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderList, segnaSelezionato } from './views/events.js';
import { renderEvent } from './views/event.js';
import { openEventForm } from './views/eventForm.js';

export const store = {
  user: null,
  settings: null,
  events: null,
  filter: 'prossimi',
  mine: false,
  q: ''
};

const root = document.getElementById('app');

try {
  const th = localStorage.getItem('ctrl.theme');
  if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th);
} catch { /* storage non disponibile */ }

setAuthLostHandler(() => {
  store.user = null;
  toast('Sessione scaduta: accedi di nuovo', 'err');
  start();
});

export function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

let elencoAl = 0;          // quando l'elenco è stato letto dal server
let revalidando = false;
let mutazioni = 0;         // quante volte l'elenco locale è stato modificato da un salvataggio
const ELENCO_FRESCO_MS = 45000;

export async function loadEvents(force = false) {
  if (store.events && !force) return store.events;
  store.events = await api('eventi.list', {});
  elencoAl = Date.now();
  return store.events;
}

/**
 * L'elenco già in memoria si mostra subito; se è più vecchio di qualche decina di secondi lo si rilegge
 * in background e la lista si aggiorna solo se qualcosa è cambiato (modifiche di altri, sincronizzazione Calendar).
 */
function revalidaElenco() {
  if (revalidando || !store.events || Date.now() - elencoAl < ELENCO_FRESCO_MS) return;
  revalidando = true;
  const mut = mutazioni;
  api('eventi.list', {}).then(nuovi => {
    elencoAl = Date.now();
    // se nel frattempo si è salvato qualcosa, la risposta potrebbe essere più vecchia dei dati locali: si scarta
    if (mut !== mutazioni || !store.events) return;
    const senzaExtra = (e) => { const { allegati, produzione, storico, ...r } = e; return r; };   // documenti e file arrivano solo da eventi.get
    if (JSON.stringify(nuovi) === JSON.stringify(store.events.map(senzaExtra))) return;
    const vecchi = new Map(store.events.map(e => [e.id, e]));
    // di un evento invariato si tengono i dati completi già caricati
    store.events = nuovi.map(e => { const v = vecchi.get(e.id); return v && v.versione === e.versione ? { ...e, allegati: v.allegati, produzione: v.produzione, storico: v.storico } : e; });
    refreshList();
  }).catch(() => { /* resta l'elenco che c'è */ }).finally(() => { revalidando = false; });
}

export function upsertEvent(ev) {
  if (!store.events) return;
  mutazioni++;
  const i = store.events.findIndex(e => e.id === ev.id);
  if (ev.stato === 'archiviato') { if (i >= 0) store.events.splice(i, 1); return; }
  if (i >= 0) store.events[i] = ev; else store.events.push(ev);
  store.events.sort((a, b) => (a.data + (a.ora_inizio || '99:99') + a.titolo).localeCompare(b.data + (b.ora_inizio || '99:99') + b.titolo));
}

function topbar() {
  const env = environment();
  const isAdmin = store.user?.permessi?.admin;
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'CTRL, torna agli eventi' }, h('span', { class: 'keycap' }, 'CTRL')),
    env === 'test' ? h('span', { class: 'env-badge', title: 'Ambiente di prova: i dati non sono quelli reali' }, 'TEST') : null,
    h('div', { class: 'grow' }),
    isAdmin ? h('a', { class: 'iconbtn', href: '#/report', title: 'Staff Work Report', 'aria-label': 'Staff Work Report' }, icon('report')) : null,
    isAdmin ? h('a', { class: 'iconbtn', href: '#/impostazioni', title: 'Impostazioni', 'aria-label': 'Impostazioni' }, icon('gear')) : null,
    h('button', { class: 'iconbtn', title: 'Esci', 'aria-label': 'Esci', onclick: logout }, icon('logout'))
  );
}

async function logout() {
  try { await api('auth.logout', {}); } catch { /* si esce comunque */ }
  session.token = '';
  store.user = null; store.events = null; store.settings = null; store.mine = false; shell = null;
  start();
}

function fatal(err) {
  root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box' },
    h('span', { class: 'keycap lg' }, 'CTRL'),
    h('div', { class: 'banner' }, err.message),
    h('button', { class: 'btn', onclick: () => start() }, 'Riprova'))));
}

let current = null;
let shell = null;   // struttura della schermata eventi, riusata tra un evento e l'altro

/** Ridisegna la lista eventi (es. indicatori cambiati) senza perdere la posizione di scorrimento. */
export function refreshList() {
  if (!current || !current.listPane.isConnected || !store.events) return;
  const y = window.scrollY;
  if (current.listPane.ridisegna) current.listPane.ridisegna();
  else renderList(current.listPane, current.selected);
  window.scrollTo(0, y);
}

/** Carica una sezione solo quando serve; se non si riesce (rete assente) lo dice invece di restare bloccati. */
async function sezione(carica, main) {
  try { return await carica(); }
  catch {
    main.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'banner' }, 'Non riesco a caricare questa sezione: controlla la connessione.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Torna agli eventi'))));
    return null;
  }
}

async function route() {
  if (!store.user) return;
  const hash = location.hash || '#/';
  const bar = topbar();

  if (hash.startsWith('#/report')) {
    if (!store.user.permessi.admin) return navigate('#/');
    const main = h('main', {}, loading('Apertura report…'));
    root.replaceChildren(bar, main);
    const m = await sezione(() => import('./views/report.js'), main);
    return m && m.renderReport(main);
  }

  if (hash.startsWith('#/impostazioni')) {
    if (!store.user.permessi.admin) return navigate('#/');
    const main = h('main', {}, loading('Apertura impostazioni…'));
    root.replaceChildren(bar, main);
    const m = await sezione(() => import('./views/settings.js'), main);
    return m && m.renderSettings(main);
  }

  const pm = hash.match(/^#\/p\/([\w-]+)(?:\/(plan|materiali))?\/?$/);
  if (pm) {
    const main = h('main', {}, loading('Apertura documento…'));
    root.replaceChildren(bar, main);
    // fogli di piano e materiale (griglia, PDF, importazioni) si caricano solo quando servono
    if (pm[2] === 'materiali') { const m = await sezione(() => import('./views/materiali.js'), main); return m && m.renderMateriali(main, pm[1]); }
    const m = await sezione(() => import('./views/plan.js'), main);
    return m && m.renderPlan(main, pm[1]);
  }

  const m = hash.match(/^#\/e\/([\w-]+)/);
  const selected = m ? m[1] : null;

  // Già nella schermata eventi: si cambia solo il dettaglio, senza ricostruire barra, lista e filtri.
  if (shell && shell.main.isConnected && root.contains(shell.main) && store.events) {
    mostraSelezione(selected);
    revalidaElenco();
    return;
  }

  const listPane = h('section', { class: 'pane-list', 'aria-label': 'Eventi' });
  const detailPane = h('section', { class: 'pane-detail', 'aria-label': 'Dettaglio evento' });
  const main = h('main', { class: 'shell' + (selected ? ' has-detail' : '') }, listPane, detailPane);
  const fab = store.user.permessi.creareEventi
    ? h('button', { class: 'fab', onclick: () => openEventForm(null) }, icon('plus'), 'Nuovo evento')
    : null;
  shell = { main, listPane, detailPane, fab, selected: null, listY: 0 };
  root.replaceChildren(bar, main, !selected && fab ? fab : '');

  if (!store.events) {
    listPane.append(loading('Caricamento eventi…'));
    try {
      await loadEvents();
    } catch (e) {
      listPane.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'banner' }, e.message), h('p', {}, h('button', { class: 'btn', onclick: () => { store.events = null; shell = null; route(); } }, 'Riprova'))));
      return;
    }
  }
  current = { listPane, selected };
  renderList(listPane, selected);
  shell.selected = selected;
  if (selected) renderEvent(detailPane, selected);
  else vuoto(detailPane);
  revalidaElenco();
}

function vuoto(detailPane) {
  detailPane.replaceChildren(h('div', { class: 'empty desk-only', style: { paddingTop: '120px' } }, h('span', { class: 'label' }, 'Nessun evento selezionato'), h('p', {}, 'Scegli un evento dalla lista.')));
}

/** Cambia l'evento aperto senza ricostruire la schermata: la lista resta dov'è, con la sua posizione di scorrimento. */
function mostraSelezione(selected) {
  const { main, listPane, detailPane, fab } = shell;
  const prima = shell.selected;
  if (prima === selected) return;
  if (!prima && selected) shell.listY = window.scrollY;
  shell.selected = selected;
  current = { listPane, selected };
  main.classList.toggle('has-detail', !!selected);
  segnaSelezionato(listPane, selected);
  if (fab) { if (selected) fab.remove(); else root.append(fab); }
  if (selected) {
    renderEvent(detailPane, selected);
    window.scrollTo(0, 0);
  } else {
    vuoto(detailPane);
    window.scrollTo(0, shell.listY || 0);
  }
}

/**
 * Avvio in una sola chiamata (profilo + impostazioni + elenco eventi). Se il server è ancora una versione
 * precedente e non conosce l'azione, si ripiega sulle chiamate separate.
 */
async function avvia() {
  try {
    const a = await api('app.avvio', {});
    store.user = a.utente; store.settings = a.impostazioni; store.events = a.eventi; elencoAl = Date.now();
  } catch (e) {
    if (e.code !== 'INVALID' || !/sconosciut/i.test(e.message)) throw e;
    store.user = await api('auth.me', {});
    try { store.settings = await api('impostazioni.get', {}); } catch { store.settings = null; }
  }
}

export async function start() {
  shell = null;
  if (!apiUrl()) {
    return fatal(new ApiError('NOT_CONFIGURED', 'CTRL non è ancora collegato al server (API non configurata). Completa l\'installazione descritta in docs/INSTALLAZIONE.md.'));
  }
  if (!session.token) {
    store.user = null;
    return renderLogin(root, async (user) => { store.user = user; await afterLogin(); });
  }
  root.replaceChildren(loading('Avvio di CTRL…'));
  try {
    await avvia();
    route();
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED') return renderLogin(root, async (user) => { store.user = user; await afterLogin(); });
    fatal(e);
  }
}

async function afterLogin() {
  try { await avvia(); } catch { /* si prosegue con quanto già noto: route() carica l'elenco */ }
  route();
}

window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

start();
