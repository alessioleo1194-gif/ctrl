import { api } from '../api.js';
import { h, icon, sheet, toast, loading } from '../ui.js';
import { store, loadEvents } from '../app.js';
import { stamp } from '../format.js';

const RUOLI = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };
const RUOLI_FORM = { PRODUCTION: 'Production · lavora su Plan e Material List', VIEWER: 'Viewer · sola lettura' };

export async function renderSettings(main) {
  const wrap = h('div', { class: 'settings' });
  main.replaceChildren(wrap);
  wrap.append(loading('Caricamento impostazioni…'));
  let users, settings;
  try {
    [users, settings] = await Promise.all([api('utenti.list', {}), api('impostazioni.get', {})]);
    store.settings = settings;
  } catch (e) {
    wrap.replaceChildren(h('div', { class: 'banner' }, e.message));
    return;
  }
  wrap.replaceChildren(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('h1', {}, 'Impostazioni'),
      h('a', { class: 'btn', href: '#/' }, icon('back'), 'Eventi')),
    usersCard(users, () => renderSettings(main)),
    listCard('aree', 'Aree del materiale', settings.liste.aree),
    listCard('provenienze', 'Provenienze del materiale', settings.liste.provenienze),
    syncCard(settings),
    themeCard(),
    h('p', { class: 'help mono' }, `CTRL ${settings.versione} · server ${settings.ambiente === 'prod' ? 'produzione' : 'test'}`)
  );
}

function usersCard(users, reload) {
  const rows = users.map(u => h('div', { class: 'urow' },
    h('div', { class: 'who' },
      h('b', {}, u.nome || u.email),
      h('small', {}, u.email),
      h('div', { class: 'chips' },
        h('span', { class: 'tag' + (u.ruolo === 'OWNER' ? ' owner' : '') }, RUOLI[u.ruolo] || u.ruolo),
        u.protetto ? h('span', { class: 'help' }, 'Non modificabile') : null,
        !u.attivo ? h('span', { class: 'tag danger' }, 'Disattivato') : null,
        u.ultimo_accesso ? h('span', { class: 'help' }, 'ultimo accesso ' + stamp(u.ultimo_accesso)) : null)),
    h('button', { class: 'btn', disabled: !!u.protetto, onclick: () => userForm(u, reload) }, 'Modifica')));
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Utenti'), h('button', { class: 'btn primary', onclick: () => userForm(null, reload) }, icon('plus'), 'Aggiungi utente')),
    h('div', { class: 'ulist' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nessun utente')));
}

function userForm(u, reload) {
  const v = u || { email: '', nome: '', ruolo: 'VIEWER', attivo: true };
  const err = h('div', { class: 'err', role: 'alert' });
  const email = h('input', { class: 'input', type: 'email', value: v.email, disabled: !!u, required: true, autocomplete: 'off' });
  const nome = h('input', { class: 'input', value: v.nome || '', maxlength: 80 });
  const ruolo = h('select', { class: 'input', disabled: !!v.protetto }, Object.entries(RUOLI_FORM).map(([k, l]) => h('option', { value: k, selected: k === v.ruolo }, l)));
  const attivo = h('input', { type: 'checkbox', checked: v.attivo !== false, disabled: !!v.protetto });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Salva');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    save.disabled = true; err.textContent = '';
    try {
      await api('utenti.save', { email: email.value, nome: nome.value, ruolo: ruolo.value, attivo: attivo.checked, versione: u ? u.versione : undefined });
      dlg.close(); toast('Utente salvato'); reload();
    } catch (x) { err.textContent = x.message; save.disabled = false; }
  } },
  h('h2', {}, u ? 'Modifica utente' : 'Nuovo utente'),
  h('label', { class: 'field' }, h('span', {}, 'Email'), email),
  h('label', { class: 'field' }, h('span', {}, 'Nome'), nome),
  h('label', { class: 'field' }, h('span', {}, 'Ruolo'), ruolo),
  h('label', { class: 'switch' }, h('span', {}, 'Accesso attivo'), attivo),
  v.protetto ? h('p', { class: 'help' }, 'Owner: ruolo e accesso non modificabili.') : h('p', { class: 'help' }, 'Il ruolo Owner non si assegna: è solo del proprietario. Se riduci i permessi o disattivi l\'accesso, la persona viene disconnessa subito.'),
  err,
  h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Annulla'), save));
  const dlg = sheet(form);
}

function listCard(nome, titolo, valori) {
  let items = valori.slice();
  const box = h('div', { class: 'lst' });
  const status = h('div', { class: 'status-line' });
  const save = h('button', { class: 'btn primary', disabled: true }, 'Salva');
  const dirty = () => { save.disabled = false; status.textContent = 'Modifiche non salvate'; status.className = 'status-line'; };
  function draw() {
    box.replaceChildren(...items.map((v, i) => h('div', { class: 'it' },
      h('input', { class: 'input', value: v, 'aria-label': 'Valore ' + (i + 1), oninput: (e) => { items[i] = e.target.value; dirty(); } }),
      h('button', { class: 'iconbtn', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; dirty(); draw(); } }, icon('up')),
      h('button', { class: 'iconbtn', title: 'Sposta giù', 'aria-label': 'Sposta giù', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; dirty(); draw(); } }, icon('down')),
      h('button', { class: 'iconbtn', title: 'Togli', 'aria-label': 'Togli ' + v, onclick: () => { items.splice(i, 1); dirty(); draw(); } }, icon('x')))));
  }
  save.addEventListener('click', async () => {
    save.disabled = true; status.textContent = 'Salvataggio…';
    try {
      const r = await api('impostazioni.lista', { lista: nome, valori: items });
      items = r.valori.slice(); draw();
      status.className = 'status-line ok'; status.textContent = 'Salvato';
    } catch (e) { status.className = 'status-line err'; status.textContent = e.message; save.disabled = false; }
  });
  draw();
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, titolo), save),
    h('div', { class: 'in', style: { display: 'grid', gap: '10px' } }, box,
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('button', { class: 'btn', onclick: () => { items.push(''); dirty(); draw(); box.lastChild.querySelector('input').focus(); } }, icon('plus'), 'Aggiungi valore'),
        status),
      h('p', { class: 'help' }, 'Togliere un valore non modifica le voci già salvate che lo usano.')));
}

function syncCard(settings) {
  const info = h('div', { class: 'help' });
  const show = (s) => {
    const e = s.sync?.esito ? safeJson(s.sync.esito) : null;
    info.textContent = s.sync?.ultimo
      ? `Ultima sincronizzazione: ${stamp(s.sync.ultimo)}` + (e && !e.errore ? ` · ${e.creati} nuovi, ${e.aggiornati} aggiornati, ${e.annullati} annullati` : e?.errore ? ` · errore: ${e.errore}` : '')
      : 'Nessuna sincronizzazione ancora eseguita.';
  };
  show(settings);
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Sincronizzazione…';
    try {
      const r = await api('sync.run', {});
      toast(`Calendar: ${r.creati} nuovi, ${r.aggiornati} aggiornati, ${r.annullati} annullati`);
      store.settings = await api('impostazioni.get', {});
      show(store.settings);
      await loadEvents(true);
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; btn.replaceChildren(icon('sync'), 'Sincronizza ora'); }
  } }, icon('sync'), 'Sincronizza ora');
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Google Calendar'), btn),
    h('div', { class: 'in', style: { display: 'grid', gap: '6px' } }, info,
      h('p', { class: 'help' }, 'La sincronizzazione automatica legge il calendario "CoolClub PRODUZIONE" ogni ora, da 30 giorni fa a un anno avanti.')));
}

function themeCard() {
  let cur = 'system';
  try { cur = localStorage.getItem('ctrl.theme') || 'system'; } catch { /* ok */ }
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
    [['system', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === cur), onclick: (e) => {
      applyTheme(k);
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, l)));
  return h('section', { class: 'card' }, h('header', {}, h('span', { class: 'label' }, 'Aspetto'), seg),
    h('div', { class: 'in help' }, 'Vale solo su questo dispositivo.'));
}

export function applyTheme(k) {
  try { localStorage.setItem('ctrl.theme', k); } catch { /* ok */ }
  if (k === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', k);
}

function safeJson(s) { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } }
