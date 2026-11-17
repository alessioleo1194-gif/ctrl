import { leggiTsv, scriviTsv } from './tsv.js';

/**
 * Griglia stile foglio di calcolo: ogni cella è un campo di testo, si scrive direttamente.
 *
 * Tastiera: frecce, Invio (giù), Tab, Ctrl+Invio (inserisci riga sotto), Ctrl+Canc (elimina righe),
 *   Ctrl+D (riempi in basso), Ctrl+Z / Ctrl+Y, Maiusc+frecce o trascinamento per selezionare più celle,
 *   Canc su più celle le svuota. Copia/incolla di blocchi da e verso Excel (testo tabulato).
 * Le colonne "combo" mostrano un elenco filtrato mentre si scrive; il testo libero resta sempre ammesso.
 * Le righe sono il modello: l'array passato viene modificato sul posto.
 */
const MAX_STORIA = 100;

export function creaGriglia(opz) {
  const colonne = opz.colonne;
  const righe = opz.righe;
  const sola = !!opz.solaLettura;
  const MAX_RIGHE = opz.maxRighe || 500;
  const vuota = opz.vuota || ((r) => colonne.every(c => !r[c.chiave]));
  const nuova = opz.nuovaRiga;
  const modificato = () => { if (opz.onModifica) opz.onModifica(); };

  let attiva = { r: 0, c: 0 };
  let sel = null;            // { r0, c0, r1, c1 } con più di una cella
  let trascina = null;
  let storia = [], rifai = [];
  let preFocus = null, storiaFocus = false;
  let popup = null;          // { input, r, c, voci, idx }
  let daMouse = null;        // cella su cui si sta cliccando col mouse
  let appenaEntrata = null;  // cella appena entrata col mouse: al click si seleziona il testo

  const el = document.createElement('div');
  el.className = 'griglia' + (sola ? ' sola' : '');
  const tabella = document.createElement('table');
  const corpo = document.createElement('tbody');
  const capo = document.createElement('thead');
  const trCapo = document.createElement('tr');
  trCapo.append(th('', 'num'));
  colonne.forEach(c => trCapo.append(th(c.titolo, 'col-' + c.chiave + (c.classe ? ' ' + c.classe : ''))));
  if (!sola) trCapo.append(th('', 'az'));
  capo.append(trCapo);
  tabella.append(capo, corpo);
  el.append(tabella);

  function th(t, cls) { const x = document.createElement('th'); x.scope = 'col'; x.className = cls; x.textContent = t; return x; }

  // ---------- disegno ----------
  const input = (r, c) => corpo.querySelector(`input[data-r="${r}"][data-c="${c}"]`);

  function cella(riga, r, c) {
    const col = colonne[c];
    const td = document.createElement('td');
    td.className = 'col-' + col.chiave + (col.classe ? ' ' + col.classe : '');
    const i = document.createElement('input');
    i.type = 'text';
    i.value = riga[col.chiave] || '';
    i.dataset.r = r; i.dataset.c = c;
    i.autocomplete = 'off'; i.spellcheck = false; i.autocapitalize = 'off';
    i.setAttribute('aria-label', (opz.etichetta ? opz.etichetta + ' · ' : '') + col.titolo + ' · riga ' + (r + 1));
    if (col.modo) i.inputMode = col.modo;
    if (sola) i.readOnly = true;
    if (col.segnaposto) i.placeholder = col.segnaposto(riga, r) || '';
    td.append(i);
    if (col.opzioni && !sola) {
      const b = document.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.className = 'caret'; b.dataset.r = r; b.dataset.c = c;
      b.setAttribute('aria-label', 'Elenco ' + col.titolo);
      b.textContent = '▾';
      td.append(b);
    }
    return td;
  }

  function trRiga(riga, r) {
    const tr = document.createElement('tr');
    tr.dataset.r = r;
    const n = document.createElement('td');
    n.className = 'num';
    const nb = document.createElement('button');
    nb.type = 'button'; nb.tabIndex = -1; nb.className = 'riga-n'; nb.dataset.r = r; nb.textContent = r + 1;
    nb.setAttribute('aria-label', 'Seleziona riga ' + (r + 1));
    n.append(nb);
    tr.append(n);
    colonne.forEach((_, c) => tr.append(cella(riga, r, c)));
    if (!sola) {
      const az = document.createElement('td');
      az.className = 'az';
      az.append(btn('+', 'ins', r, 'Inserisci una riga sotto la riga ' + (r + 1)), btn('×', 'del', r, 'Elimina la riga ' + (r + 1)));
      tr.append(az);
    }
    return tr;
  }
  function btn(t, act, r, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.tabIndex = -1; b.className = 'riga-' + act; b.dataset.act = act; b.dataset.r = r;
    b.textContent = t; b.setAttribute('aria-label', label);
    return b;
  }

  function ridisegna(focus) {
    const f = focus || (el.contains(document.activeElement) && document.activeElement.dataset && document.activeElement.dataset.r !== undefined
      ? { r: +document.activeElement.dataset.r, c: +document.activeElement.dataset.c } : null);
    chiudiPopup();
    corpo.replaceChildren(...righe.map((x, r) => trRiga(x, r)));
    mostraSel();
    if (f) { const i = input(Math.min(f.r, righe.length - 1), f.c); if (i) i.focus({ preventScroll: false }); }
  }

  /** Aggiorna segnaposti e valori senza ricreare le righe (es. sezione ereditata). */
  function aggiorna() {
    corpo.querySelectorAll('input').forEach(i => {
      const r = +i.dataset.r, col = colonne[+i.dataset.c], riga = righe[r];
      if (!riga) return;
      if (col.segnaposto) i.placeholder = col.segnaposto(riga, r) || '';
      if (document.activeElement !== i && i.value !== (riga[col.chiave] || '')) i.value = riga[col.chiave] || '';
    });
  }

  function cresci() {
    if (!opz.autoCresci) return false;
    let cambiato = false;
    const minimo = opz.minimoRighe || 1;
    while (righe.length < minimo && righe.length < MAX_RIGHE) { righe.push(nuova()); cambiato = true; }
    if (righe.length && !vuota(righe[righe.length - 1]) && righe.length < MAX_RIGHE) { righe.push(nuova()); cambiato = true; }
    return cambiato;
  }
  function aggiungiDomRighe() {
    for (let r = corpo.children.length; r < righe.length; r++) corpo.append(trRiga(righe[r], r));
  }

  // ---------- storia (annulla / ripeti) ----------
  const foto = () => JSON.stringify(righe);
  function ripristina(s) { righe.splice(0, righe.length, ...JSON.parse(s)); }
  function salvaStoria(s) { storia.push(s || foto()); if (storia.length > MAX_STORIA) storia.shift(); rifai = []; }
  function annulla() {
    if (!storia.length) return;
    rifai.push(foto()); ripristina(storia.pop());
    sel = null; ridisegna(); modificato();
  }
  function ripeti() {
    if (!rifai.length) return;
    storia.push(foto()); ripristina(rifai.pop());
    sel = null; ridisegna(); modificato();
  }

  // ---------- selezione ----------
  function rect() {
    if (!sel) return { r0: attiva.r, c0: attiva.c, r1: attiva.r, c1: attiva.c };
    return { r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) };
  }
  function mostraSel() {
    corpo.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    corpo.querySelectorAll('tr.riga-sel').forEach(x => x.classList.remove('riga-sel'));
    if (!sel) return;
    const b = rect();
    for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) { const i = input(r, c); if (i) i.parentElement.classList.add('sel'); }
  }
  function impostaSel(r1, c1) {
    sel = (r1 === attiva.r && c1 === attiva.c) ? null : { r0: attiva.r, c0: attiva.c, r1, c1 };
    mostraSel();
  }

  // ---------- modifiche ----------
  function imposta(r, c, valore) {
    const col = colonne[c];
    let v = String(valore == null ? '' : valore);
    if (col.normalizza) { const n = col.normalizza(v); if (n !== null) v = n; }
    righe[r][col.chiave] = v;
  }
  function assicuraRighe(n) {
    while (righe.length < n && righe.length < MAX_RIGHE) righe.push(nuova());
  }

  function incolla(matrice, r0, c0) {
    salvaStoria();
    const b = sel ? rect() : null;
    if (matrice.length === 1 && matrice[0].length === 1 && b) {
      for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) imposta(r, c, matrice[0][0]);
    } else {
      assicuraRighe(r0 + matrice.length);
      matrice.forEach((riga, i) => riga.forEach((v, j) => {
        if (r0 + i < righe.length && c0 + j < colonne.length) imposta(r0 + i, c0 + j, v);
      }));
    }
    cresci();
    ridisegna({ r: Math.min(r0, righe.length - 1), c: c0 });
    modificato();
  }

  function testoSelezione() {
    const b = rect();
    const m = [];
    for (let r = b.r0; r <= b.r1; r++) { const x = []; for (let c = b.c0; c <= b.c1; c++) x.push(righe[r][colonne[c].chiave] || ''); m.push(x); }
    return scriviTsv(m);
  }
  function svuotaSel() {
    salvaStoria();
    const b = rect();
    for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) righe[r][colonne[c].chiave] = '';
    cresci(); ridisegna(); modificato();
  }

  function inserisci(dopo) {
    if (righe.length >= MAX_RIGHE) return;
    salvaStoria();
    righe.splice(dopo + 1, 0, nuova());
    ridisegna({ r: dopo + 1, c: attiva.c });
    modificato();
  }
  function elimina(r0, r1) {
    salvaStoria();
    righe.splice(r0, r1 - r0 + 1);
    if (!righe.length) righe.push(nuova());
    cresci(); sel = null;
    ridisegna({ r: Math.min(r0, righe.length - 1), c: attiva.c });
    modificato();
  }
  function riempiGiu() {
    const b = rect();
    salvaStoria();
    if (b.r0 === b.r1) {
      if (b.r0 === 0) return;
      for (let c = b.c0; c <= b.c1; c++) righe[b.r0][colonne[c].chiave] = righe[b.r0 - 1][colonne[c].chiave] || '';
    } else {
      for (let r = b.r0 + 1; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) righe[r][colonne[c].chiave] = righe[b.r0][colonne[c].chiave] || '';
    }
    cresci(); ridisegna(); modificato();
  }

  // ---------- elenco a tendina ----------
  const lista = document.createElement('div');
  lista.className = 'combo-lista'; lista.setAttribute('role', 'listbox'); lista.hidden = true;
  document.body.append(lista);

  function voci(c, r, testo) {
    const tutte = (colonne[c].opzioni(righe[r]) || []).map(o => typeof o === 'string' ? { valore: o } : o);
    const t = testo.trim().toLowerCase();
    if (!t) return tutte.slice(0, 60);
    const inizia = tutte.filter(o => o.valore.toLowerCase().startsWith(t));
    const contiene = tutte.filter(o => !o.valore.toLowerCase().startsWith(t) && o.valore.toLowerCase().includes(t));
    return inizia.concat(contiene).slice(0, 40);
  }
  function apriPopup(i, tutte) {
    const r = +i.dataset.r, c = +i.dataset.c;
    if (!colonne[c].opzioni || sola) return;
    const v = voci(c, r, tutte ? '' : i.value);
    const t = i.value.trim().toLowerCase();
    const esatta = v.length === 1 && v[0].valore.toLowerCase() === t;
    if (!v.length || esatta) { chiudiPopup(); return; }
    popup = { input: i, r, c, voci: v, idx: !tutte && t && v[0].valore.toLowerCase().startsWith(t) ? 0 : -1 };
    lista.replaceChildren(...v.map((o, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.setAttribute('role', 'option'); b.dataset.k = k;
      b.textContent = o.valore;
      if (o.dettaglio) { const s = document.createElement('small'); s.textContent = o.dettaglio; b.append(s); }
      return b;
    }));
    const p = i.getBoundingClientRect();
    lista.hidden = false;
    lista.style.minWidth = Math.max(p.width, 180) + 'px';
    const alto = Math.min(lista.scrollHeight, 260);
    const sotto = window.innerHeight - p.bottom;
    lista.style.left = Math.max(4, Math.min(p.left, window.innerWidth - lista.offsetWidth - 4)) + 'px';
    lista.style.top = (sotto < alto + 8 && p.top > sotto ? p.top - alto - 2 : p.bottom + 2) + 'px';
    evidenzia();
  }
  function evidenzia() {
    [...lista.children].forEach((b, k) => { const on = popup && k === popup.idx; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({ block: 'nearest' }); });
  }
  function chiudiPopup() { popup = null; lista.hidden = true; }

  function scegli(o, avanti) {
    const { r, c } = popup;
    chiudiPopup();
    if (!storiaFocus) { salvaStoria(preFocus); storiaFocus = true; }
    righe[r][colonne[c].chiave] = o.valore;
    if (opz.onScelta) opz.onScelta(righe[r], colonne[c].chiave, o);
    cresci();
    ridisegna({ r, c: avanti && c < colonne.length - 1 ? c + 1 : c });
    modificato();
  }

  lista.addEventListener('mousedown', (e) => e.preventDefault());
  lista.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b && popup) scegli(popup.voci[+b.dataset.k], false);
  });

  // ---------- eventi ----------
  corpo.addEventListener('focusin', (e) => {
    const i = e.target;
    if (i.tagName !== 'INPUT') return;
    attiva = { r: +i.dataset.r, c: +i.dataset.c };
    if (!trascina && sel) { sel = null; mostraSel(); }
    preFocus = foto(); storiaFocus = false;
    // come in un foglio di calcolo: entrando in una cella con mouse o tastiera il testo è selezionato e scrivendo lo si sostituisce.
    // Col dito no: lì si tocca per correggere una parola.
    if (daMouse === i && !sola) { daMouse = null; appenaEntrata = i; }
  });

  corpo.addEventListener('input', (e) => {
    const i = e.target;
    if (i.tagName !== 'INPUT') return;
    const r = +i.dataset.r, c = +i.dataset.c;
    if (!storiaFocus) { salvaStoria(preFocus); storiaFocus = true; }
    righe[r][colonne[c].chiave] = i.value;
    if (cresci()) aggiungiDomRighe();
    apriPopup(i, false);
    if (opz.onCella) opz.onCella(righe[r], colonne[c].chiave, r);
    modificato();
  });

  corpo.addEventListener('focusout', (e) => {
    const i = e.target;
    if (i.tagName !== 'INPUT') return;
    const r = +i.dataset.r, c = +i.dataset.c, col = colonne[c];
    setTimeout(() => { if (popup && popup.input === i && document.activeElement !== i) chiudiPopup(); }, 0);
    if (!righe[r]) return;
    if (col.normalizza) {
      const n = col.normalizza(i.value);
      i.classList.toggle('errore', n === null);
      i.title = n === null ? 'Valore non riconosciuto' : '';
      if (n !== null && n !== i.value) { i.value = n; righe[r][col.chiave] = n; modificato(); }
    }
    if (opz.onUscita) opz.onUscita(righe[r], col.chiave, r);
  });

  corpo.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.act === 'ins') return inserisci(+b.dataset.r);
    if (b && b.dataset.act === 'del') return elimina(+b.dataset.r, +b.dataset.r);
    if (b && b.classList.contains('riga-n')) {
      const r = +b.dataset.r;
      attiva = { r, c: 0 };
      sel = { r0: r, c0: 0, r1: r, c1: colonne.length - 1 };
      mostraSel();
      const i = input(r, 0); if (i) i.focus();
      sel = { r0: r, c0: 0, r1: r, c1: colonne.length - 1 }; mostraSel();
      return;
    }
    if (b && b.classList.contains('caret')) {
      const i = input(+b.dataset.r, +b.dataset.c);
      i.focus();
      if (popup && popup.input === i) chiudiPopup(); else apriPopup(i, true);
      return;
    }
    const i = e.target;
    if (i.tagName === 'INPUT' && appenaEntrata === i) { appenaEntrata = null; i.select(); }
    if (i.tagName === 'INPUT' && colonne[+i.dataset.c].opzioni && !i.value && !sola) apriPopup(i, true);
  });

  // selezione trascinando il mouse
  corpo.addEventListener('pointerdown', (e) => {
    daMouse = e.pointerType === 'touch' ? null : e.target;
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const i = e.target;
    if (i.tagName === 'INPUT') {
      if (e.shiftKey && el.contains(document.activeElement) && document.activeElement.dataset.r !== undefined) {
        e.preventDefault();
        impostaSel(+i.dataset.r, +i.dataset.c);
        return;
      }
      trascina = { r: +i.dataset.r, c: +i.dataset.c, mosso: false };
    }
  });
  corpo.addEventListener('pointerover', (e) => {
    if (!trascina || !(e.buttons & 1)) return;
    const i = e.target;
    if (i.tagName !== 'INPUT') return;
    const r = +i.dataset.r, c = +i.dataset.c;
    if (!trascina.mosso && r === trascina.r && c === trascina.c) return;
    if (!trascina.mosso) { trascina.mosso = true; attiva = { r: trascina.r, c: trascina.c }; const a = input(trascina.r, trascina.c); if (a) a.focus(); }
    window.getSelection().removeAllRanges();
    impostaSel(r, c);
  });
  document.addEventListener('pointerup', () => { trascina = null; });
  corpo.addEventListener('selectstart', (e) => { if (trascina && trascina.mosso) e.preventDefault(); });

  corpo.addEventListener('copy', (e) => {
    if (!sel) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', testoSelezione());
  });
  corpo.addEventListener('cut', (e) => {
    if (!sel || sola) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', testoSelezione()); svuotaSel();
  });
  corpo.addEventListener('paste', (e) => {
    if (sola) return;
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    const m = leggiTsv(t);
    if (!m.length) return;
    if (m.length === 1 && m[0].length === 1 && !sel) return; // una sola cella: incolla normale
    e.preventDefault();
    const b = rect();
    incolla(m, b.r0, b.c0);
  });

  function vai(r, c) {
    r = Math.max(0, Math.min(righe.length - 1, r)); c = Math.max(0, Math.min(colonne.length - 1, c));
    const i = input(r, c);
    if (i) { i.focus(); i.select(); }
  }

  corpo.addEventListener('keydown', (e) => {
    const i = e.target;
    if (i.tagName !== 'INPUT') return;
    const r = +i.dataset.r, c = +i.dataset.c;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (popup && popup.input === i) {
      if (k === 'ArrowDown') { e.preventDefault(); popup.idx = (popup.idx + 1) % popup.voci.length; return evidenzia(); }
      if (k === 'ArrowUp') { e.preventDefault(); popup.idx = popup.idx <= 0 ? popup.voci.length - 1 : popup.idx - 1; return evidenzia(); }
      if ((k === 'Enter' || k === 'Tab') && popup.idx >= 0 && !e.shiftKey && !ctrl) {
        e.preventDefault(); return scegli(popup.voci[popup.idx], true);
      }
      if (k === 'Escape') { e.preventDefault(); return chiudiPopup(); }
    }
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); return e.shiftKey ? ripeti() : annulla(); }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); return ripeti(); }
    if (sola) {
      if (k === 'ArrowDown' || k === 'Enter') { e.preventDefault(); vai(r + 1, c); }
      if (k === 'ArrowUp') { e.preventDefault(); vai(r - 1, c); }
      return;
    }
    if (ctrl && k === 'Enter') { e.preventDefault(); return inserisci(r); }
    if (ctrl && k === 'Delete') { e.preventDefault(); const b = rect(); return elimina(b.r0, b.r1); }
    if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); return riempiGiu(); }
    if (ctrl && (k === 'a' || k === 'A') && !i.value) { e.preventDefault(); attiva = { r: 0, c: 0 }; sel = { r0: 0, c0: 0, r1: righe.length - 1, c1: colonne.length - 1 }; return mostraSel(); }

    const multi = !!sel;
    if ((k === 'Delete' || k === 'Backspace') && multi) { e.preventDefault(); return svuotaSel(); }
    if (k === 'Escape') { if (sel) { sel = null; mostraSel(); } return; }

    if (e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      const cur = sel ? { r: sel.r1, c: sel.c1 } : attiva;
      return impostaSel(Math.max(0, Math.min(righe.length - 1, cur.r + (k === 'ArrowDown' ? 1 : -1))), cur.c);
    }
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && (multi || i.selectionStart === i.selectionEnd && (k === 'ArrowLeft' ? i.selectionStart === 0 : i.selectionEnd === i.value.length))) {
      e.preventDefault();
      const cur = sel ? { r: sel.r1, c: sel.c1 } : attiva;
      return impostaSel(cur.r, Math.max(0, Math.min(colonne.length - 1, cur.c + (k === 'ArrowRight' ? 1 : -1))));
    }
    if (e.shiftKey && k !== 'Enter' && k !== 'Tab') return;
    if (k === 'ArrowDown') { e.preventDefault(); return vai(r + 1, c); }
    if (k === 'ArrowUp') { e.preventDefault(); return vai(r - 1, c); }
    if (k === 'ArrowLeft' && i.selectionStart === 0 && i.selectionEnd === 0 && c > 0) { e.preventDefault(); return vai(r, c - 1); }
    if (k === 'ArrowRight' && i.selectionStart === i.value.length && i.selectionEnd === i.value.length && c < colonne.length - 1) { e.preventDefault(); return vai(r, c + 1); }
    if (k === 'Enter') { e.preventDefault(); return vai(e.shiftKey ? r - 1 : r + 1, c); }
  });

  cresci();
  ridisegna();
  return {
    el, ridisegna, aggiorna, righe,
    focus: (r, c) => vai(r, c || 0),
    annulla, ripeti,
    inserisci, elimina,
    distruggi: () => { lista.remove(); }
  };
}
