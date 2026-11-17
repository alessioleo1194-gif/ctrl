import { api, session, setAuthLostHandler, ApiError } from './api.js';
import { environment, apiUrl } from './config.js';
import { h, icon, toast, loading } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderList } from './views/events.js';
import { renderEvent } from './views/event.js';
import { openEventForm } from './views/eventForm.js';
import { renderSettings } from './views/settings.js';
import { renderPlan } from './views/plan.js';
import { renderMateriali } from './views/materiali.js';

export const store = {
  user: null,
  settings: null,
  events: null,
  filter: 'prossimi',
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

export async function loadEvents(force = false) {
  if (store.events && !force) return store.events;
  store.events = await api('eventi.list', {});
  return store.events;
}

export function upsertEvent(ev) {
  if (!store.events) return;
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
    isAdmin ? h('a', { class: 'iconbtn', href: '#/impostazioni', title: 'Impostazioni', 'aria-label': 'Impostazioni' }, icon('gear')) : null,
    h('button', { class: 'iconbtn', title: 'Esci', 'aria-label': 'Esci', onclick: logout }, icon('logout'))
  );
}

async function logout() {
  try { await api('auth.logout', {}); } catch { /* si esce comunque */ }
  session.token = '';
  store.user = null; store.events = null; store.settings = null;
  start();
}

function fatal(err) {
  root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box' },
    h('span', { class: 'keycap lg' }, 'CTRL'),
    h('div', { class: 'banner' }, err.message),
    h('button', { class: 'btn', onclick: () => start() }, 'Riprova'))));
}

let current = null;

/** Ridisegna la lista eventi (es. indicatori cambiati) senza perdere la posizione di scorrimento. */
export function refreshList() {
  if (!current || !current.listPane.isConnected || !store.events) return;
  const y = window.scrollY;
  renderList(current.listPane, current.selected);
  window.scrollTo(0, y);
}

async function route() {
  if (!store.user) return;
  const hash = location.hash || '#/';
  const bar = topbar();

  if (hash.startsWith('#/impostazioni')) {
    if (!store.user.permessi.admin) return navigate('#/');
    const main = h('main');
    root.replaceChildren(bar, main);
    return renderSettings(main);
  }

  const pm = hash.match(/^#\/p\/([\w-]+)(?:\/(plan|materiali))?\/?$/);
  if (pm) {
    const main = h('main');
    root.replaceChildren(bar, main);
    return pm[2] === 'materiali' ? renderMateriali(main, pm[1]) : renderPlan(main, pm[1]);
  }

  const m = hash.match(/^#\/e\/([\w-]+)/);
  const selected = m ? m[1] : null;
  const listPane = h('section', { class: 'pane-list', 'aria-label': 'Eventi' });
  const detailPane = h('section', { class: 'pane-detail', 'aria-label': 'Dettaglio evento' });
  const shell = h('main', { class: 'shell' + (selected ? ' has-detail' : '') }, listPane, detailPane);
  const fab = store.user.permessi.creareEventi && !selected
    ? h('button', { class: 'fab', onclick: () => openEventForm(null) }, icon('plus'), 'Nuovo evento')
    : null;
  root.replaceChildren(bar, shell, fab || '');

  listPane.append(loading('Caricamento eventi…'));
  try {
    await loadEvents();
  } catch (e) {
    listPane.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'banner' }, e.message), h('p', {}, h('button', { class: 'btn', onclick: () => { store.events = null; route(); } }, 'Riprova'))));
    return;
  }
  current = { listPane, selected };
  renderList(listPane, selected);
  if (selected) renderEvent(detailPane, selected);
  else detailPane.append(h('div', { class: 'empty desk-only', style: { paddingTop: '120px' } }, h('span', { class: 'label' }, 'Nessun evento selezionato'), h('p', {}, 'Scegli un evento dalla lista.')));
}

export async function start() {
  if (!apiUrl()) {
    return fatal(new ApiError('NOT_CONFIGURED', 'CTRL non è ancora collegato al server (API non configurata). Completa l\'installazione descritta in docs/INSTALLAZIONE.md.'));
  }
  if (!session.token) {
    store.user = null;
    return renderLogin(root, async (user) => { store.user = user; await afterLogin(); });
  }
  root.replaceChildren(loading('Avvio di CTRL…'));
  try {
    store.user = await api('auth.me', {});
    await afterLogin();
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED') return renderLogin(root, async (user) => { store.user = user; await afterLogin(); });
    fatal(e);
  }
}

async function afterLogin() {
  try { store.settings = await api('impostazioni.get', {}); } catch { store.settings = null; }
  route();
}

window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

start();
