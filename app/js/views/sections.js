import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { store, refreshList } from '../app.js';
import { stamp } from '../format.js';

/**
 * Sezioni di produzione di un evento: piano, materiale, scheda tecnica.
 * Ognuna: righe strutturate + testo libero + file allegati (salvati su Drive).
 */
const MAX_BYTE = 20 * 1024 * 1024;

const DEF = {
  piano: {
    titolo: 'Piano di produzione', vuoto: 'Nessun orario, testo o file.',
    aggiungi: 'Aggiungi attività',
    campi: [
      { k: 'ora_inizio', l: 'Inizio', type: 'time', w: '96px' },
      { k: 'ora_fine', l: 'Fine', type: 'time', w: '96px' },
      { k: 'attivita', l: 'Attività', req: true, w: 'minmax(160px, 2fr)' },
      { k: 'responsabile', l: 'Responsabile', w: 'minmax(110px, 1fr)' },
      { k: 'note', l: 'Note', w: 'minmax(110px, 1fr)' }
    ]
  },
  materiale: {
    titolo: 'Lista materiale', vuoto: 'Nessuna voce, testo o file.',
    aggiungi: 'Aggiungi voce',
    campi: [
      { k: 'quantita', l: 'Q.tà', w: '64px', mode: 'numeric' },
      { k: 'voce', l: 'Voce', req: true, w: 'minmax(160px, 2fr)' },
      { k: 'area', l: 'Area', lista: 'aree', w: 'minmax(100px, 1fr)' },
      { k: 'provenienza', l: 'Provenienza', lista: 'provenienze', w: 'minmax(120px, 1fr)' },
      { k: 'note', l: 'Note', w: 'minmax(100px, 1fr)' }
    ]
  },
  scheda: {
    titolo: 'Scheda tecnica', vuoto: 'Nessuna channel list, testo o file (es. il rider).',
    aggiungi: 'Aggiungi canale',
    campi: [
      { k: 'numero', l: 'N.', w: '56px', mode: 'numeric' },
      { k: 'sorgente', l: 'Sorgente', req: true, w: 'minmax(120px, 2fr)' },
      { k: 'microfono', l: 'Microfono', w: 'minmax(100px, 1fr)' },
      { k: 'di', l: 'DI', w: 'minmax(70px, .7fr)' },
      { k: 'asta', l: 'Asta', w: 'minmax(70px, .7fr)' },
      { k: 'note', l: 'Note', w: 'minmax(100px, 1fr)' }
    ]
  }
};

export const ORDINE = ['piano', 'materiale', 'scheda'];

const hasContent = (s) => s.righe.length > 0 || !!s.testo || s.allegati.length > 0;

function fmtByte(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

/** Aggiorna l'indicatore nella lista eventi senza ricaricarla. */
function syncIndicator(ev, key, sec) {
  const on = hasContent(sec);
  ev.stato_doc = { ...ev.stato_doc, [key]: on };
  const e = store.events?.find(x => x.id === ev.id);
  if (e && e.stato_doc[key] !== on) { e.stato_doc = { ...e.stato_doc, [key]: on }; refreshList(); }
}

export function sectionCard(ev, key) {
  const d = DEF[key];
  const p = store.user.permessi;
  let sec = ev.sezioni[key];
  const card = h('section', { class: 'card sec', id: 'sec-' + key, 'data-sezione': key });

  function setSec(next) {
    sec = next;
    ev.sezioni[key] = next;
    syncIndicator(ev, key, next);
  }

  function header(extra) {
    return h('header', {},
      h('span', { class: 'sec-title' }, icon(key, 'sec-ico ' + key + (hasContent(sec) ? ' on' : '')), h('span', { class: 'label' }, d.titolo)),
      extra);
  }

  // ---------- visualizzazione ----------
  function show() {
    const body = h('div', { class: 'in sec-body' });
    if (sec.righe.length) body.append(table());
    if (sec.testo) body.append(h('div', { class: 'pre sec-text' }, sec.testo));
    body.append(files());
    if (!hasContent(sec)) body.prepend(h('p', { class: 'help', style: { margin: 0 } }, d.vuoto));
    const editBtn = p.modificare ? h('button', { class: 'btn', onclick: edit }, icon('edit'), sec.righe.length || sec.testo ? 'Modifica' : 'Compila') : null;
    card.replaceChildren(header(editBtn), body);
  }

  function table() {
    const cols = d.campi.filter(c => sec.righe.some(r => r[c.k]) || c.req);
    return h('div', { class: 'tbl-wrap' },
      h('table', { class: 'tbl tbl-' + key },
        h('thead', {}, h('tr', {}, cols.map(c => h('th', { scope: 'col' }, c.l)))),
        h('tbody', {}, sec.righe.map(r => h('tr', {}, cols.map(c =>
          h('td', { 'data-l': c.l, class: c.type === 'time' || c.mode ? 'mono' : '' }, r[c.k] || (c.req ? '' : '—'))))))));
  }

  function files() {
    const wrap = h('div', { class: 'files' });
    const status = h('div', { class: 'status-line' });
    sec.allegati.forEach(a => {
      const canDel = p.caricare && (p.admin || a.caricato_da === store.user.email);
      wrap.append(h('div', { class: 'file' },
        h('button', { class: 'file-main', title: 'Scarica ' + a.nome, 'aria-label': `Scarica ${a.nome} (${fmtByte(a.byte)})`, onclick: (e) => download(a, e.currentTarget, status) },
          icon('clip'),
          h('span', { class: 'file-name' }, a.nome),
          h('span', { class: 'help mono' }, fmtByte(a.byte) + ' · ' + stamp(a.caricato_il))),
        canDel ? removeBtn(a, status) : null));
    });
    if (p.caricare) {
      const input = h('input', { type: 'file', multiple: true, class: 'sr', 'aria-label': 'Allega file a ' + d.titolo });
      input.addEventListener('change', () => { const list = [...input.files]; input.value = ''; upload(list, status); });
      wrap.append(h('label', { class: 'btn file-add' }, icon('plus'), 'Allega file', input));
    }
    wrap.append(status);
    return wrap;
  }

  function removeBtn(a, status) {
    let armed = false;
    const b = h('button', { class: 'iconbtn', title: 'Togli ' + a.nome, 'aria-label': 'Togli ' + a.nome, onclick: async () => {
      if (!armed) {
        armed = true; b.classList.add('armed'); b.textContent = 'Togli?';
        b.setAttribute('aria-label', 'Conferma: togli ' + a.nome);
        setTimeout(() => {
          if (!b.isConnected) return;
          armed = false; b.classList.remove('armed'); b.replaceChildren(icon('x')); b.setAttribute('aria-label', 'Togli ' + a.nome);
        }, 4000);
        return;
      }
      b.disabled = true;
      try {
        setSec(await api('allegati.elimina', { id: a.id }));
        toast('File spostato nel cestino di Drive');
        show();
      } catch (e) { status.className = 'status-line err'; status.textContent = e.message; b.disabled = false; }
    } }, icon('x'));
    return b;
  }

  async function upload(list, status) {
    if (!list.length) return;
    const tooBig = list.filter(f => f.size > MAX_BYTE);
    const ok = list.filter(f => f.size <= MAX_BYTE && f.size > 0);
    let errors = tooBig.map(f => f.name + ': troppo grande (max 20 MB)');
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i];
      status.className = 'status-line';
      status.replaceChildren(h('span', { class: 'spinner' }), `Caricamento ${ok.length > 1 ? (i + 1) + ' di ' + ok.length + ': ' : ''}${f.name}…`);
      try {
        const dati = await toBase64(f);
        setSec(await api('allegati.carica', { evento_id: ev.id, sezione: key, nome: f.name, mime: f.type || 'application/octet-stream', dati }));
      } catch (e) { errors.push(f.name + ': ' + e.message); }
    }
    show();
    const st = card.querySelector('.files .status-line');
    if (errors.length) { st.className = 'status-line err'; st.textContent = errors.join(' · '); }
    else if (ok.length) toast(ok.length === 1 ? 'File caricato' : ok.length + ' file caricati');
  }

  async function download(a, btn, status) {
    btn.disabled = true;
    status.className = 'status-line';
    status.replaceChildren(h('span', { class: 'spinner' }), 'Download di ' + a.nome + '…');
    try {
      const r = await api('allegati.scarica', { id: a.id });
      const bin = atob(r.dati);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'application/octet-stream' }));
      const link = h('a', { href: url, download: r.nome });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = '';
    } catch (e) { status.className = 'status-line err'; status.textContent = e.message; }
    btn.disabled = false;
  }

  // ---------- modifica (righe + testo) ----------
  function edit() {
    const liste = store.settings?.liste || {};
    let rows = sec.righe.map(r => ({ ...r }));
    const list = h('div', { class: 'rows', style: { '--cols': d.campi.map(c => c.w).join(' ') + ' auto' } });
    const status = h('div', { class: 'status-line' });

    function field(r, c, i) {
      const id = `${key}-${i}-${c.k}`;
      let el;
      if (c.lista) {
        const vals = liste[c.lista] || [];
        const opts = vals.includes(r[c.k]) || !r[c.k] ? vals : [r[c.k], ...vals];
        el = h('select', { class: 'input', id }, h('option', { value: '' }, '—'), opts.map(v => h('option', { value: v, selected: v === r[c.k] }, v)));
      } else {
        el = h('input', { class: 'input', id, type: c.type || 'text', value: r[c.k] || '', inputmode: c.mode || null, autocomplete: 'off' });
      }
      el.addEventListener('input', () => { r[c.k] = el.value; dirty(); });
      el.addEventListener('change', () => { r[c.k] = el.value; dirty(); });
      return h('label', { class: 'cell' + (c.req ? ' req' : '') }, h('span', { class: 'cell-l' }, c.l + (c.req ? ' *' : '')), el);
    }

    function draw(focusIndex) {
      list.replaceChildren(
        h('div', { class: 'rows-head', 'aria-hidden': 'true' }, d.campi.map(c => h('span', {}, c.l + (c.req ? ' *' : ''))), h('span', {})),
        ...rows.map((r, i) => h('div', { class: 'rrow' },
          d.campi.map(c => field(r, c, i)),
          h('div', { class: 'rtools' },
            h('button', { class: 'iconbtn', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su riga ' + (i + 1), disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); dirty(); } }, icon('up')),
            h('button', { class: 'iconbtn', type: 'button', title: 'Sposta giù', 'aria-label': 'Sposta giù riga ' + (i + 1), disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); dirty(); } }, icon('down')),
            h('button', { class: 'iconbtn', type: 'button', title: 'Togli riga', 'aria-label': 'Togli riga ' + (i + 1), onclick: () => { rows.splice(i, 1); draw(); dirty(); } }, icon('x'))))));
      if (focusIndex !== undefined) list.querySelectorAll('.rrow')[focusIndex]?.querySelector('input, select')?.focus();
    }

    function addRow() {
      const r = {};
      if (key === 'scheda') {
        const last = rows.map(x => parseInt(x.numero, 10)).filter(n => !isNaN(n)).pop();
        r.numero = String((last || 0) + 1);
      }
      rows.push(r);
      draw(rows.length - 1);
      dirty();
    }

    const ta = h('textarea', { class: 'input', 'aria-label': 'Testo libero · ' + d.titolo, placeholder: 'Testo libero: puoi incollare qui una lista o delle indicazioni.' }, sec.testo);
    ta.addEventListener('input', dirty);

    const save = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: doSave }, 'Salva');
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => {
      if (!save.disabled && !cancelArmed) { cancelArmed = true; cancel.textContent = 'Scarta modifiche?'; setTimeout(() => { cancelArmed = false; if (cancel.isConnected) cancel.textContent = 'Annulla'; }, 4000); return; }
      show();
    } }, 'Annulla');
    let cancelArmed = false;

    /** Righe come le vede il server: campi ripuliti, righe vuote tolte. */
    function clean(list = rows) {
      return list.map(r => {
        const o = r.id ? { id: r.id } : {};
        d.campi.forEach(c => { o[c.k] = (r[c.k] || '').trim(); });
        return o;
      }).filter(o => d.campi.some(c => o[c.k]));
    }
    const righeIniziali = JSON.stringify(clean(sec.righe));
    const testoIniziale = sec.testo;
    function dirty() {
      save.disabled = JSON.stringify(clean()) === righeIniziali && ta.value === testoIniziale;
      status.className = 'status-line';
      status.textContent = save.disabled ? '' : 'Modifiche non salvate';
    }

    async function doSave() {
      const righe = clean();
      const missing = righe.findIndex(r => d.campi.some(c => c.req && !r[c.k]));
      if (missing >= 0) {
        const c = d.campi.find(x => x.req);
        status.className = 'status-line err';
        status.textContent = `Riga ${missing + 1}: manca "${c.l}".`;
        return;
      }
      save.disabled = true; save.textContent = 'Salvataggio…';
      try {
        let v = sec.versione;
        let res = null;
        if (JSON.stringify(righe) !== righeIniziali) { res = await api('sezioni.righe', { evento_id: ev.id, sezione: key, versione: v, righe }); v = res.versione; }
        if (ta.value !== testoIniziale) { res = await api('sezioni.testo', { evento_id: ev.id, sezione: key, versione: v, testo: ta.value }); }
        if (res) setSec(res);
        toast(d.titolo + ' salvato');
        show();
      } catch (e) {
        save.textContent = 'Salva'; save.disabled = false;
        status.className = 'status-line err';
        status.textContent = e.code === 'CONFLICT'
          ? 'Qualcun altro ha appena modificato questa sezione. Copia le tue modifiche, poi ricarica la pagina.'
          : e.message;
      }
    }

    draw();
    card.replaceChildren(
      header(null),
      h('div', { class: 'in sec-edit' },
        list,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: addRow }, icon('plus'), d.aggiungi)),
        h('label', { class: 'field' }, h('span', {}, 'Testo libero'), ta),
        h('div', { class: 'sec-actions' }, status, h('div', { class: 'row' }, cancel, save))));
    if (!rows.length && !sec.testo) addRow();
  }

  show();
  return card;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('File non leggibile'));
    r.readAsDataURL(file);
  });
}
