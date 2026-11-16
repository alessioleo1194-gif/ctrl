import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { store, refreshList } from '../app.js';
import { stamp } from '../format.js';

/**
 * File allegati a un evento (rider, PdP già pronti, foto), salvati su Drive nella
 * cartella dell'evento e raggruppati per sezione. Piano, materiale e channel list
 * si compilano invece nella scheda di produzione.
 */
const MAX_BYTE = 20 * 1024 * 1024;

const SEZIONI = [
  { k: 'piano', titolo: 'Piano di produzione' },
  { k: 'materiale', titolo: 'Lista materiale' },
  { k: 'scheda', titolo: 'Scheda tecnica e rider' }
];

function fmtByte(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

/** Aggiorna l'indicatore nella lista eventi senza ricaricarla. */
function syncIndicator(ev, key, files) {
  const on = files.length > 0;
  ev.stato_doc = { ...ev.stato_doc, [key]: on };
  const e = store.events?.find(x => x.id === ev.id);
  if (e && e.stato_doc[key] !== on) { e.stato_doc = { ...e.stato_doc, [key]: on }; refreshList(); }
}

export function allegatiCard(ev) {
  const p = store.user.permessi;
  const card = h('section', { class: 'card', id: 'allegati' });
  const totale = () => SEZIONI.reduce((n, s) => n + ev.allegati[s.k].length, 0);

  function draw() {
    const groups = SEZIONI.filter(s => p.caricare || ev.allegati[s.k].length).map(s => group(s));
    card.replaceChildren(
      h('header', {}, h('span', { class: 'label' }, 'File allegati'), h('span', { class: 'help mono' }, String(totale()))),
      h('div', { class: 'in files-groups' },
        groups.length ? groups : h('p', { class: 'help', style: { margin: 0 } }, 'Nessun file allegato.')));
  }

  function group(s) {
    const list = ev.allegati[s.k];
    const status = h('div', { class: 'status-line' });
    const wrap = h('div', { class: 'files', id: 'files-' + s.k },
      h('div', { class: 'files-title' }, icon(s.k, 'sec-ico ' + s.k + (list.length ? ' on' : '')), h('span', {}, s.titolo)));
    list.forEach(a => {
      const canDel = p.caricare && (p.admin || a.caricato_da === store.user.email);
      wrap.append(h('div', { class: 'file' },
        h('button', { class: 'file-main', title: 'Scarica ' + a.nome, 'aria-label': `Scarica ${a.nome} (${fmtByte(a.byte)})`, onclick: (e) => download(a, e.currentTarget, status) },
          icon('clip'),
          h('span', { class: 'file-name' }, a.nome),
          h('span', { class: 'help mono' }, fmtByte(a.byte) + ' · ' + stamp(a.caricato_il))),
        canDel ? removeBtn(s.k, a, status) : null));
    });
    if (p.caricare) {
      const input = h('input', { type: 'file', multiple: true, class: 'sr', 'aria-label': 'Allega file a ' + s.titolo });
      input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; upload(s.k, files, status); });
      wrap.append(h('label', { class: 'btn file-add' }, icon('plus'), 'Allega file', input));
    }
    wrap.append(status);
    return wrap;
  }

  function setFiles(key, files) {
    ev.allegati[key] = files;
    syncIndicator(ev, key, files);
  }

  function removeBtn(key, a, status) {
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
        setFiles(key, (await api('allegati.elimina', { id: a.id })).allegati);
        toast('File spostato nel cestino di Drive');
        draw();
      } catch (e) { status.className = 'status-line err'; status.textContent = e.message; b.disabled = false; }
    } }, icon('x'));
    return b;
  }

  async function upload(key, list, status) {
    if (!list.length) return;
    const ok = list.filter(f => f.size <= MAX_BYTE && f.size > 0);
    const errors = list.filter(f => f.size > MAX_BYTE).map(f => f.name + ': troppo grande (max 20 MB)');
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i];
      status.className = 'status-line';
      status.replaceChildren(h('span', { class: 'spinner' }), `Caricamento ${ok.length > 1 ? (i + 1) + ' di ' + ok.length + ': ' : ''}${f.name}…`);
      try {
        const dati = await toBase64(f);
        setFiles(key, (await api('allegati.carica', { evento_id: ev.id, sezione: key, nome: f.name, mime: f.type || 'application/octet-stream', dati })).allegati);
      } catch (e) { errors.push(f.name + ': ' + e.message); }
    }
    draw();
    const st = card.querySelector('#files-' + key + ' .status-line');
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

  draw();
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
