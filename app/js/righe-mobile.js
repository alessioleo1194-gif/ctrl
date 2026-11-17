import { sheet } from './ui.js';

/**
 * Compilazione da telefono: al posto della griglia a colonne (che sullo schermo piccolo taglia le colonne)
 * un elenco di righe compatte; toccando una riga si apre un editor con un campo per volta, caratteri a 16 px,
 * "Avanti" per passare alla riga dopo. Stessi dati, stesso salvataggio e stesso documento della griglia:
 * l'array `righe` è il modello e si modifica sul posto.
 *
 * Accetta le stesse opzioni di creaGriglia (colonne, righe, nuovaRiga, vuota, autoCresci, onModifica, onCella,
 * onScelta, solaLettura…) più `riassunto(riga, indice)` → { testa, titolo, sotto } e `visibileMobile(riga)`.
 */
export function creaRigheMobile(opz) {
  const colonne = opz.colonne;
  const righe = opz.righe;
  const sola = !!opz.solaLettura;
  const MAX = opz.maxRighe || 500;
  const vuota = opz.vuota || ((r) => colonne.every(c => !r[c.chiave]));
  const visibile = opz.visibileMobile || ((r) => !vuota(r));
  const modificato = () => { if (opz.onModifica) opz.onModifica(); };

  const el = document.createElement('div');
  el.className = 'righe-m' + (sola ? ' sola' : '');
  el.dataset.etichetta = opz.etichetta || '';

  const cresci = () => {
    if (!opz.autoCresci) return;
    const minimo = opz.minimoRighe || 1;
    while (righe.length < minimo && righe.length < MAX) righe.push(opz.nuovaRiga());
    if (righe.length && !vuota(righe[righe.length - 1]) && righe.length < MAX) righe.push(opz.nuovaRiga());
  };

  function riassunto(riga, r) {
    if (opz.riassunto) return opz.riassunto(riga, r);
    const v = colonne.map(c => riga[c.chiave]).filter(Boolean);
    return { testa: '', titolo: v[0] || '', sotto: v.slice(1).join(' · ') };
  }

  const indiciVisibili = () => righe.map((x, r) => r).filter(r => visibile(righe[r]));

  function carta(r) {
    const s = riassunto(righe[r], r);
    const corpo = [
      Object.assign(document.createElement('span'), { className: 'rm-t', textContent: s.testa || '' }),
      (() => {
        const d = document.createElement('span'); d.className = 'rm-c';
        const b = document.createElement('b'); b.textContent = s.titolo || '—';
        const u = document.createElement('small'); u.textContent = s.sotto || '';
        d.append(b); if (s.sotto) d.append(u);
        return d;
      })()
    ];
    if (sola) {
      const d = document.createElement('div'); d.className = 'rm-riga sola'; d.append(...corpo); return d;
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rm-riga';
    b.setAttribute('aria-label', (opz.etichetta ? opz.etichetta + ' · ' : '') + 'riga ' + (r + 1) + ': ' + (s.titolo || 'vuota'));
    b.dataset.r = r;
    b.append(...corpo);
    b.addEventListener('click', () => apriEditor(r));
    return b;
  }

  function ridisegna() {
    cresci();
    const idx = indiciVisibili();
    const nodi = idx.map(carta);
    if (!idx.length) {
      const v = document.createElement('div'); v.className = 'rm-vuoto'; v.textContent = sola ? 'Nessuna riga.' : 'Nessuna riga ancora.'; nodi.push(v);
    }
    if (!sola) {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'rm-aggiungi'; a.textContent = '+ Aggiungi riga';
      a.setAttribute('aria-label', (opz.etichetta ? opz.etichetta + ' · ' : '') + 'Aggiungi riga');
      a.disabled = righe.length >= MAX;
      a.addEventListener('click', () => apriEditor(nuovaPosizione()));
      nodi.push(a);
    }
    el.replaceChildren(...nodi);
  }

  /** Dove mettere una riga nuova: una riga libera già presente (vuota e nascosta) oppure in fondo. */
  function nuovaPosizione() {
    const libera = righe.findIndex(x => !visibile(x) && vuota(x));
    if (libera >= 0) return libera;
    righe.push(opz.nuovaRiga());
    return righe.length - 1;
  }

  function inserisciDopo(r) {
    righe.splice(r + 1, 0, opz.nuovaRiga());
    modificato();
    return r + 1;
  }

  function apriEditor(r) {
    let corrente = r;
    const campi = [];
    const titolo = document.createElement('h2');
    const err = document.createElement('div'); err.className = 'err'; err.setAttribute('role', 'alert');
    const form = document.createElement('form');
    form.className = 'rm-editor'; form.noValidate = true;
    form.addEventListener('submit', (e) => { e.preventDefault(); chiudi(); });

    colonne.forEach((c, ci) => {
      const lab = document.createElement('label'); lab.className = 'field';
      const sp = document.createElement('span'); sp.textContent = c.titolo;
      const i = document.createElement('input');
      i.type = 'text'; i.className = 'input'; i.autocomplete = 'off'; i.spellcheck = false;
      i.autocapitalize = c.modo ? 'off' : 'sentences';
      if (c.modo) i.inputMode = c.modo;
      i.setAttribute('aria-label', c.titolo);
      let dl = null;
      if (c.opzioni) {
        dl = document.createElement('datalist'); dl.id = 'rm-dl-' + Math.random().toString(36).slice(2);
        i.setAttribute('list', dl.id);
      }
      i.addEventListener('input', () => {
        const riga = righe[corrente];
        riga[c.chiave] = i.value;
        if (c.opzioni) scelta(c, i.value);
        if (opz.onCella) opz.onCella(riga, c.chiave);
        cresci();
        modificato();
        titoloEditor();
      });
      i.addEventListener('change', () => {
        if (c.normalizza) {
          const riga = righe[corrente];
          const n = c.normalizza(i.value);
          if (n !== undefined && n !== null && n !== i.value) { i.value = n; riga[c.chiave] = n; if (opz.onCella) opz.onCella(riga, c.chiave); modificato(); }
        }
      });
      lab.append(sp, i); if (dl) lab.append(dl);
      campi.push({ c, i, dl });
      form.append(lab);
    });

    /** Un suggerimento scelto dall'elenco può compilare altri campi (es. ruolo e telefono della crew). */
    function scelta(c, valore) {
      if (!opz.onScelta || !valore) return;
      const o = (c.opzioni(righe[corrente]) || []).find(x => String(x.valore).toLowerCase() === valore.toLowerCase());
      if (!o) return;
      opz.onScelta(righe[corrente], c.chiave, o);
      campi.forEach(({ c: cc, i }) => { if (cc !== c && document.activeElement !== i) i.value = righe[corrente][cc.chiave] || ''; });
    }

    function carica() {
      const riga = righe[corrente];
      campi.forEach(({ c, i, dl }) => {
        i.value = riga[c.chiave] || '';
        i.placeholder = c.segnaposto ? (c.segnaposto(riga, corrente) || '') : '';
        if (dl) dl.replaceChildren(...(c.opzioni(riga) || []).slice(0, 60).map(o => Object.assign(document.createElement('option'), { value: o.valore, label: o.dettaglio || '' })));
      });
      titoloEditor();
      prec.disabled = indiciVisibili().indexOf(corrente) <= 0 && !indiciVisibili().length;
      const pos = indiciVisibili().indexOf(corrente);
      prec.disabled = pos <= 0;
    }
    function titoloEditor() {
      const idx = indiciVisibili();
      const pos = idx.indexOf(corrente);
      const nome = (opz.etichetta ? opz.etichetta + ' · ' : '');
      titolo.textContent = nome + (pos >= 0 ? `Riga ${pos + 1} di ${idx.length}` : 'Nuova riga');
    }

    const prec = btn('‹ Prec.', () => {
      const idx = indiciVisibili(); const pos = idx.indexOf(corrente);
      vaiA(pos > 0 ? idx[pos - 1] : corrente);
    });
    const avanti = btn('Avanti ›', () => {
      const idx = indiciVisibili(); const pos = idx.indexOf(corrente);
      if (pos >= 0 && pos < idx.length - 1) return vaiA(idx[pos + 1]);
      if (righe.length >= MAX) return;
      const n = nuovaPosizione(); vaiA(n);
    }, 'p');
    const sotto = btn('+ Riga sotto', () => { if (righe.length >= MAX) return; vaiA(inserisciDopo(corrente)); });
    let armato = false;
    const elimina = btn('Elimina riga', () => {
      if (!armato) { armato = true; elimina.textContent = 'Conferma: elimina'; setTimeout(() => { armato = false; elimina.textContent = 'Elimina riga'; }, 3500); return; }
      righe.splice(corrente, 1);
      cresci();
      modificato();
      chiudi();
    }, 'd');
    const fatto = btn('Fatto', () => chiudi(), 'p');
    fatto.type = 'submit';

    function vaiA(n) { corrente = n; armato = false; elimina.textContent = 'Elimina riga'; carica(); campi[0].i.focus(); }
    function btn(t, fn, cls) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (cls === 'p' ? ' primary' : cls === 'd' ? ' danger' : ''); b.textContent = t;
      b.addEventListener('click', fn);
      return b;
    }
    function chiudi() { dlg.close(); }

    const nav = document.createElement('div'); nav.className = 'rm-nav'; nav.append(prec, avanti);
    const az = document.createElement('div'); az.className = 'rm-nav'; az.append(sotto, elimina);
    const fine = document.createElement('div'); fine.className = 'actions'; fine.append(fatto);
    form.prepend(titolo);
    form.append(err, nav, az, fine);
    const dlg = sheet(form);
    dlg.addEventListener('close', () => { ridisegna(); });
    carica();
    if (!righe[corrente] || !visibile(righe[corrente])) titoloEditor();
  }

  ridisegna();
  return {
    el, righe,
    ridisegna, aggiorna: ridisegna,
    focus: () => {},   // sul telefono non si apre l'editor da solo (la tastiera comparirebbe senza che lo si sia chiesto)
    annulla: () => {}, ripeti: () => {},
    inserisci: (dopo) => { inserisciDopo(dopo); ridisegna(); },
    elimina: (r0, r1) => { righe.splice(r0, (r1 ?? r0) - r0 + 1); cresci(); modificato(); ridisegna(); },
    distruggi: () => {}
  };
}

/** True sugli schermi stretti (telefono): lì si usa l'elenco di righe invece della griglia a colonne. */
export function schermoStretto() {
  try { return window.matchMedia('(max-width: 700px)').matches; } catch { return false; }
}
