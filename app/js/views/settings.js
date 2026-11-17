import { api } from '../api.js';
import { h, icon, sheet, toast, loading } from '../ui.js';
import { store, loadEvents } from '../app.js';
import { stamp, dataIt, dateNelTesto, dispositivo } from '../format.js';

const RUOLI = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };
const RUOLI_FORM = { PRODUCTION: 'Production · lavora su Plan e Material List', VIEWER: 'Viewer · sola lettura' };

export async function renderSettings(main) {
  const wrap = h('div', { class: 'settings' });
  main.replaceChildren(wrap);
  wrap.append(loading('Caricamento impostazioni…'));
  let users, settings, richieste, registro;
  try {
    [users, settings, richieste, registro] = await Promise.all([
      api('utenti.list', {}), api('impostazioni.get', {}), api('accesso.richieste', {}), api('accessi.list', {})
    ]);
    store.settings = settings;
  } catch (e) {
    wrap.replaceChildren(h('div', { class: 'banner' }, e.message));
    return;
  }
  const reload = () => renderSettings(main);
  const cUtenti = usersCard(users, reload);
  const cRichieste = richiesteCard(richieste, reload);
  wrap.replaceChildren(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('h1', {}, 'Impostazioni'),
      h('a', { class: 'btn', href: '#/' }, icon('back'), 'Eventi')),
    // le richieste in attesa vanno prima: sono l'unica cosa che aspetta una tua decisione
    ...(richieste.length ? [cRichieste, cUtenti] : [cUtenti, cRichieste]),
    logCard(registro),
    listCard('aree', 'Aree del materiale', settings.liste.aree),
    listCard('provenienze', 'Provenienze del materiale', settings.liste.provenienze),
    syncCard(settings),
    themeCard(),
    h('p', { class: 'help mono' }, `CTRL ${settings.versione} · server ${settings.ambiente === 'prod' ? 'produzione' : 'test'}`)
  );
}

function scadenzaTag(u) {
  if (u.protetto) return null;
  if (!u.scade_il) return h('span', { class: 'tag' }, 'Nessuna scadenza');
  if (u.scaduto) return h('span', { class: 'tag danger' }, /^\d{4}-/.test(u.scade_il) ? `Scaduto il ${dataIt(u.scade_il)}` : 'Scadenza non valida');
  const n = u.giorni_rimasti;
  const data = dataIt(u.scade_il);
  const testo = n === 0 ? 'Scade oggi' : n === 1 ? `Scade domani · ${data}` : n <= 7 ? `Scade tra ${n} giorni · ${data}` : `Scade il ${data}`;
  return h('span', { class: 'tag' + (n <= 7 ? ' warn' : '') }, testo);
}

const FILTRI_UTENTI = [
  ['tutti', 'Tutti', () => true],
  ['attivi', 'Attivi', u => u.attivo && !u.scaduto],
  ['scadenza', 'In scadenza', u => u.attivo && !u.scaduto && !!u.scade_il && u.giorni_rimasti !== null && u.giorni_rimasti <= 7],
  ['scaduti', 'Scaduti', u => u.scaduto]
];

function usersCard(users, reload) {
  let filtro = 'tutti';
  const list = h('div', { class: 'ulist' });
  const bar = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filtro utenti' });

  async function proroga(u) {
    try {
      const r = await api('utenti.proroga', { email: u.email, giorni: 30 });
      toast(`Accesso di ${u.nome || u.email} valido fino al ${dataIt(r.scade_il)}`);
      reload();
    } catch (e) { toast(e.message, 'err'); }
  }

  function draw() {
    bar.replaceChildren(...FILTRI_UTENTI.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === filtro), onclick: () => { filtro = k; draw(); } }, l)));
    const pred = FILTRI_UTENTI.find(f => f[0] === filtro)[2];
    const visibili = users.filter(pred);
    list.replaceChildren(...(visibili.length ? visibili.map(u => h('div', { class: 'urow' },
      h('div', { class: 'who' },
        h('b', {}, u.nome || u.email),
        h('small', {}, u.email),
        h('div', { class: 'chips' },
          h('span', { class: 'tag' + (u.ruolo === 'OWNER' ? ' owner' : '') }, RUOLI[u.ruolo] || u.ruolo),
          u.protetto ? h('span', { class: 'help' }, 'Non modificabile · nessuna scadenza') : null,
          !u.attivo ? h('span', { class: 'tag danger' }, 'Disattivato') : null,
          scadenzaTag(u),
          h('span', { class: 'help' }, u.ultimo_accesso ? 'ultimo accesso ' + stamp(u.ultimo_accesso) : 'mai acceduto'),
          u.sessioni ? h('span', { class: 'help' }, u.sessioni === 1 ? '· 1 dispositivo' : `· ${u.sessioni} dispositivi`) : null)),
      h('div', { class: 'uact' },
        !u.protetto && u.scade_il ? h('button', { class: 'btn sm', onclick: () => proroga(u) }, u.scaduto ? 'Riattiva +30 giorni' : '+30 giorni') : null,
        h('button', { class: 'btn', disabled: !!u.protetto, onclick: () => userForm(u, reload) }, 'Modifica'))))
      : [h('div', { class: 'empty' }, users.length ? 'Nessun utente in questo filtro' : 'Nessun utente')]));
  }
  draw();
  return h('section', { class: 'card' },
    h('header', {}, h('span', { class: 'label' }, 'Utenti'), h('button', { class: 'btn primary', onclick: () => userForm(null, reload) }, icon('plus'), 'Aggiungi utente')),
    h('div', { class: 'logbar' }, bar),
    list);
}

function userForm(u, reload) {
  const v = u || { email: '', nome: '', ruolo: 'VIEWER', attivo: true, scade_il: '' };
  const err = h('div', { class: 'err', role: 'alert' });
  const email = h('input', { class: 'input', type: 'email', value: v.email, disabled: !!u, required: true, autocomplete: 'off' });
  const nome = h('input', { class: 'input', value: v.nome || '', maxlength: 80 });
  const ruolo = h('select', { class: 'input', disabled: !!v.protetto }, Object.entries(RUOLI_FORM).map(([k, l]) => h('option', { value: k, selected: k === v.ruolo }, l)));
  const attivo = h('input', { type: 'checkbox', checked: v.attivo !== false, disabled: !!v.protetto });
  const scade = h('input', { class: 'input', type: 'date', value: v.scade_il || '', disabled: !!v.protetto });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Salva');
  const disp = h('div', { class: 'disp' });
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    save.disabled = true; err.textContent = '';
    try {
      await api('utenti.save', { email: email.value, nome: nome.value, ruolo: ruolo.value, attivo: attivo.checked, scade_il: scade.value, versione: u ? u.versione : undefined });
      dlg.close(); toast('Utente salvato'); reload();
    } catch (x) { err.textContent = x.message; save.disabled = false; }
  } },
  h('h2', {}, u ? 'Modifica utente' : 'Nuovo utente'),
  h('label', { class: 'field' }, h('span', {}, 'Email'), email),
  h('label', { class: 'field' }, h('span', {}, 'Nome'), nome),
  h('label', { class: 'field' }, h('span', {}, 'Ruolo'), ruolo),
  h('label', { class: 'field' }, h('span', {}, 'Accesso valido fino al'), scade),
  h('p', { class: 'help' }, 'Vuoto = nessuna scadenza. L\'accesso termina a fine giornata (ora italiana): il giorno dopo la sessione si chiude e il login dice "Accesso scaduto".'),
  h('label', { class: 'switch' }, h('span', {}, 'Accesso attivo'), attivo),
  v.protetto ? h('p', { class: 'help' }, 'Owner: ruolo, scadenza e accesso non modificabili.') : h('p', { class: 'help' }, 'Il ruolo Owner non si assegna: è solo del proprietario. Se riduci i permessi o disattivi l\'accesso, la persona viene disconnessa subito.'),
  u && !v.protetto ? disp : null,
  err,
  h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Annulla'), save));
  const dlg = sheet(form);
  if (u && !v.protetto) dispositivi(disp, u);
}

/** Dispositivi connessi di un utente, con disconnessione remota. */
async function dispositivi(box, u) {
  box.replaceChildren(h('span', { class: 'help' }, 'Dispositivi connessi…'));
  let sessioni;
  try { sessioni = await api('utenti.sessioni', { email: u.email }); }
  catch (e) { box.replaceChildren(h('span', { class: 'err' }, e.message)); return; }
  const chiudi = async (id) => {
    try {
      await api('utenti.disconnetti', id ? { email: u.email, id } : { email: u.email });
      toast(id ? 'Dispositivo disconnesso' : 'Disconnesso da tutti i dispositivi');
      dispositivi(box, u);
    } catch (e) { toast(e.message, 'err'); }
  };
  box.replaceChildren(
    h('span', { class: 'help', style: { fontWeight: '600' } }, 'Dispositivi connessi'),
    ...(sessioni.length ? sessioni.map(s => h('div', { class: 'sess' },
      h('div', {}, h('b', {}, dispositivo(s.dispositivo) || 'Dispositivo sconosciuto'),
        h('small', {}, `ultimo uso ${stamp(s.ultimo_uso)} · acceduto ${stamp(s.creata)}`)),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => chiudi(s.id) }, 'Disconnetti')))
      : [h('div', { class: 'help' }, 'Nessun dispositivo connesso.')]),
    sessioni.length > 1 ? h('div', {}, h('button', { class: 'btn sm danger', type: 'button', onclick: () => chiudi('') }, 'Disconnetti da tutti i dispositivi')) : null);
}

const DURATE = [['30', 'Valido 30 giorni'], ['7', 'Valido 7 giorni'], ['0', 'Senza scadenza']];

function richiesteCard(richieste, reload) {
  const righe = richieste.map(r => {
    const ruolo = h('select', { class: 'input', 'aria-label': 'Ruolo per ' + r.email }, Object.entries({ VIEWER: 'Viewer', PRODUCTION: 'Production' }).map(([k, l]) => h('option', { value: k }, l)));
    const durata = h('select', { class: 'input', 'aria-label': 'Durata per ' + r.email }, DURATE.map(([k, l]) => h('option', { value: k }, l)));
    const agisci = async (azione, btn) => {
      btn.disabled = true;
      try {
        await api('accesso.gestisci', { id: r.id, azione, ruolo: ruolo.value, giorni: Number(durata.value) });
        toast(azione === 'approva' ? `${r.email} può accedere` : 'Richiesta rifiutata');
        reload();
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    };
    const ok = h('button', { class: 'btn primary sm', onclick: () => agisci('approva', ok) }, 'Approva');
    const no = h('button', { class: 'btn danger sm', onclick: () => agisci('rifiuta', no) }, 'Rifiuta');
    return h('div', { class: 'req' },
      h('div', {}, h('b', {}, r.nome || '(nome non indicato)'), ' ', h('span', { class: 'help' }, `${r.email} · ${stamp(r.creata_il)}`)),
      r.messaggio ? h('p', { class: 'qt' }, r.messaggio) : null,
      h('div', { class: 'row' }, ruolo, durata, ok, no));
  });
  return h('section', { class: 'card', id: 'richieste-accesso' },
    h('header', {}, h('span', { class: 'label' }, 'Richieste di accesso'),
      richieste.length ? h('span', { class: 'tag warn' }, `${richieste.length} in attesa`) : null),
    ...(righe.length ? righe : [h('div', { class: 'in help' }, 'Nessuna richiesta in attesa.')]),
    h('div', { class: 'in help' }, 'Approvando, la persona entra con il normale codice via email: non parte nessuna email automatica. Rifiutando, la stessa email non può rifare richiesta per 7 giorni.'));
}

const EVENTI_LOG = {
  login: () => 'Accesso con codice',
  logout: () => 'Uscita',
  codice_errato: (r) => `Codice errato (${(r.dettaglio || '').toLowerCase()})`,
  codici_esauriti: () => 'Codice errato: tentativi esauriti',
  accesso_scaduto: (r) => r.attore ? `Accesso scaduto: ${dateNelTesto(r.dettaglio)}` : 'Accesso scaduto: login rifiutato · ' + dateNelTesto(r.dettaglio),
  accesso_negato: () => 'Accesso negato: utente disattivato',
  richiesta: () => 'Richiesta di accesso',
  richiesta_approvata: (r) => `Richiesta di ${r.email} approvata${r.dettaglio ? ' · ' + dateNelTesto(r.dettaglio) : ''}`,
  richiesta_rifiutata: (r) => `Richiesta di ${r.email} rifiutata`,
  utente_creato: (r) => `Utente ${r.email} creato · ${dateNelTesto(r.dettaglio)}`,
  ruolo: (r) => `Ruolo di ${r.email}: ${r.dettaglio}`,
  scadenza: (r) => `Scadenza di ${r.email}: ${dateNelTesto(r.dettaglio)}`,
  disattivato: (r) => `Accesso disattivato a ${r.email}`,
  riattivato: (r) => `Accesso riattivato a ${r.email}`,
  disconnessione: (r) => `Disconnessione remota di ${r.email}: ${(r.dettaglio || '').toLowerCase()}`
};
const ESITI_LOG = { ok: 'OK', ko: 'Rifiutato', attesa: 'In attesa', scaduto: 'Scaduto' };
const FILTRI_LOG = [['tutto', 'Tutto'], ['accessi', 'Accessi'], ['problemi', 'Problemi'], ['richieste', 'Richieste'], ['amministrazione', 'Amministrazione']];

function logCard(iniziale) {
  let filtro = 'tutto';
  let q = '';
  let seq = 0;
  const bar = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filtro registro' });
  const ricerca = h('input', { class: 'input', type: 'search', placeholder: 'Cerca email…', 'aria-label': 'Cerca nel registro', maxlength: '80' });
  const tab = h('div', { class: 'logwrap' });
  const nota = h('div', { class: 'in help' });
  let timer;

  function disegna(dati) {
    const r = dati.righe;
    tab.replaceChildren(r.length ? h('table', { class: 'logtbl' },
      h('thead', {}, h('tr', {}, ['Quando', 'Utente', 'Evento', 'Dispositivo', 'Esito'].map(c => h('th', {}, c)))),
      h('tbody', {}, r.map(x => h('tr', {},
        h('td', { class: 't' }, stamp(x.ts)),
        h('td', {}, x.attore ? (x.attore === 'sistema' ? 'Sistema' : x.attore) : x.email),
        h('td', {}, (EVENTI_LOG[x.evento] || (() => x.evento))(x)),
        h('td', { class: 'dev' }, dispositivo(x.dispositivo) || '—'),
        h('td', { class: 'e-' + x.esito }, ESITI_LOG[x.esito] || x.esito)))))
      : h('div', { class: 'empty' }, 'Nessuna riga.'));
    nota.textContent = `${dati.totale > r.length ? `Ultime ${r.length} righe di ${dati.totale}. ` : ''}Si conservano ${dati.conserva_giorni} giorni, poi si cancellano da sole. Il dispositivo è quello dichiarato dal browser; l'indirizzo IP non è disponibile.`;
  }
  function filtri() {
    bar.replaceChildren(...FILTRI_LOG.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === filtro), onclick: () => { filtro = k; filtri(); carica(); } }, l)));
  }
  async function carica() {
    const mio = ++seq;
    try {
      const d = await api('accessi.list', { filtro, q });
      if (mio === seq) disegna(d);
    } catch (e) { if (mio === seq) tab.replaceChildren(h('div', { class: 'banner' }, e.message)); }
  }
  ricerca.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = ricerca.value.trim(); carica(); }, 250); });
  filtri();
  disegna(iniziale);
  return h('section', { class: 'card', id: 'registro-accessi' },
    h('header', {}, h('span', { class: 'label' }, 'Registro accessi')),
    h('div', { class: 'logbar' }, bar, ricerca),
    tab, nota);
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
