import { api } from '../api.js';
import { h, icon, toast, loading } from '../ui.js';
import { store, navigate, loadEvents } from '../app.js';
import { longDate, dateRange, shortDate } from '../format.js';
import { creaSalvataggio, nuovoId } from '../autosave.js';
import { bloccoProgramma } from './programma.js';

/**
 * Scheda di produzione: panoramica, programma (Production Schedule), struttura (giornate e spazi),
 * persone (squadra e rubrica).
 * Tutto si salva da solo; la pagina resta la fonte di verità mentre si scrive.
 */
const BLOCCHI = [
  { k: 'panoramica', l: 'Panoramica' },
  { k: 'programma', l: 'Programma' },
  { k: 'struttura', l: 'Struttura' },
  { k: 'persone', l: 'Persone' }
];
const TIPI_SPAZIO = [['venue', 'Venue'], ['palco', 'Palco'], ['sala', 'Sala'], ['magazzino', 'Magazzino'], ['altro', 'Altro']];
const STATO_TESTO = { vuoto: 'Da compilare', in_corso: 'Da completare', completo: 'Completo' };

let attiva = null; // pagina corrente: per salvare prima di uscire

window.addEventListener('beforeunload', (e) => {
  if (attiva && attiva.saver.inSospeso()) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('hashchange', () => {
  if (attiva && !location.hash.startsWith('#/p/' + attiva.id)) { attiva.saver.subito(); attiva = null; }
});

export async function renderProduzione(main, pid, blocco = 'panoramica') {
  if (attiva && attiva.id === pid) {
    attiva.mostra(blocco, main);
    return;
  }
  main.replaceChildren(loading('Apertura della scheda di produzione…'));
  let prod;
  try {
    prod = await api('produzione.get', { id: pid });
  } catch (e) {
    main.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'banner' }, e.code === 'NOT_FOUND' ? 'Scheda di produzione non trovata.' : e.message),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Torna agli eventi'))));
    return;
  }
  attiva = pagina(prod);
  attiva.mostra(blocco, main);
}

function pagina(prod) {
  const mod = prod.permessi.modificare;
  const versioni = new Map();
  let rubrica = null;
  let corrente = 'panoramica';
  let mainEl = null;
  const statoProgramma = {};

  const indicatore = h('span', { class: 'save-ind', role: 'status', 'aria-live': 'polite' }, 'Tutto salvato');
  const nav = h('nav', { class: 'prod-nav', 'aria-label': 'Blocchi della scheda' });
  const corpo = h('div', { class: 'prod-body' });

  const saver = creaSalvataggio({
    id: prod.id,
    onStato: (s) => { indicatore.textContent = s.testo; indicatore.dataset.stato = s.tipo; },
    onRisposta: (r) => {
      prod.blocchi = r.blocchi;
      prod.avvisi = r.avvisi;
      ['giornate', 'spazi', 'squadra', 'attivita'].forEach(l => (r[l] || []).forEach(x => versioni.set(x.id, x.versione)));
      prod.versione = r.versione;
      (r.conflitti || []).forEach(c => toast(`${c.da} aveva modificato questo elemento poco prima: i campi che hai cambiato tu sono stati salvati sopra.`, 'err'));
      disegnaNav();
      if (corrente === 'panoramica') aggiornaCruscotto();
    }
  });

  function salva(tipo, azione, id, campi) {
    saver.metti({ tipo, azione, id, campi, versione: id ? versioni.get(id) : prod.versione });
  }

  prod.attivita = prod.attivita || [];
  prod.catalogo_attivita = prod.catalogo_attivita || [];
  [...prod.giornate, ...prod.spazi, ...prod.squadra, ...prod.attivita].forEach(x => versioni.set(x.id, x.versione));

  // ---------- intestazione e navigazione ----------

  function testa() {
    const ev = prod.eventi[0];
    const back = prod.eventi.length === 1
      ? h('a', { class: 'btn ghost', href: '#/e/' + ev.id, style: { marginLeft: '-10px', paddingLeft: '6px' } }, icon('back'), 'Evento')
      : h('a', { class: 'btn ghost', href: '#/', style: { marginLeft: '-10px', paddingLeft: '6px' } }, icon('back'), 'Eventi');
    const titolo = mod
      ? h('input', { class: 'prod-title', value: prod.nome, 'aria-label': 'Nome della scheda di produzione', maxlength: 120 })
      : h('h1', { class: 'prod-title' }, prod.nome);
    if (mod) {
      titolo.addEventListener('input', () => {
        const v = titolo.value.trim();
        titolo.setAttribute('aria-invalid', v ? 'false' : 'true');
        if (v) { prod.nome = v; salva('produzione', 'modifica', null, { nome: v }); }
      });
    }
    const date = prod.giornate.length
      ? (prod.giornate.length === 1 ? longDate(prod.giornate[0].data) : `${shortDate(prod.giornate[0].data)} – ${shortDate(prod.giornate.at(-1).data)} · ${prod.giornate.length} giornate`)
      : 'Nessuna giornata';
    return h('header', { class: 'prod-head' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, back, indicatore),
      h('span', { class: 'label' }, prod.tipo === 'festival' ? 'Scheda di produzione · festival' : 'Scheda di produzione'),
      titolo,
      h('div', { class: 'detail-meta' }, h('span', { class: 'prod-date' }, date)));
  }

  function disegnaNav() {
    nav.replaceChildren(...BLOCCHI.map(b => {
      const st = b.k === 'panoramica' ? null : prod.blocchi[b.k]?.stato;
      const n = b.k === 'panoramica' ? prod.avvisi.length : prod.avvisi.filter(a => a.blocco === b.k).length;
      return h('a', { href: `#/p/${prod.id}/${b.k}`, 'aria-current': corrente === b.k ? 'page' : null, class: 'prod-tab' },
        st ? h('span', { class: 'dot ' + st, 'aria-hidden': 'true' }) : null,
        h('span', {}, b.l),
        n ? h('span', { class: 'count', title: n + (n === 1 ? ' avviso' : ' avvisi') }, String(n)) : null);
    }));
  }

  function mostra(blocco, main) {
    corrente = BLOCCHI.some(b => b.k === blocco) ? blocco : 'panoramica';
    if (main !== mainEl) {
      mainEl = main;
      main.className = 'prod';
      main.replaceChildren(testa(), h('div', { class: 'prod-grid' }, nav, corpo));
    }
    disegnaNav();
    disegnaBlocco();
    window.scrollTo(0, 0);
  }

  function disegnaBlocco() {
    if (corrente === 'programma') corpo.replaceChildren(...bloccoProgramma({ prod, mod, salva, card, conferma, stato: statoProgramma, saver, ridisegna: disegnaBlocco }));
    else if (corrente === 'struttura') corpo.replaceChildren(...struttura());
    else if (corrente === 'persone') corpo.replaceChildren(...persone());
    else corpo.replaceChildren(...panoramica());
  }

  // ---------- campi ----------

  function campo(valore, onValore, opts = {}) {
    if (!mod) return h('span', { class: 'ro' + (valore ? '' : ' help') }, valore || opts.vuoto || '—');
    const el = h('input', { class: 'input', value: valore || '', placeholder: opts.placeholder || '', 'aria-label': opts.label, maxlength: opts.max || 200, type: opts.type || 'text', inputmode: opts.inputmode || null, autocomplete: 'off' });
    el.addEventListener('input', () => {
      const v = el.value.trim();
      if (opts.richiesto && !v) { el.setAttribute('aria-invalid', 'true'); return; }
      el.removeAttribute('aria-invalid');
      onValore(v);
    });
    return el;
  }

  function scelta(valore, opzioni, onValore, label) {
    if (!mod) {
      const o = opzioni.find(x => x[0] === valore);
      return h('span', { class: 'ro' }, o ? o[1] : '—');
    }
    const el = h('select', { class: 'input', 'aria-label': label }, opzioni.map(([v, l]) => h('option', { value: v, selected: v === valore }, l)));
    el.addEventListener('change', () => onValore(el.value));
    return el;
  }

  function conferma(btn, testo, azione) {
    let armato = false;
    const etichetta = btn.getAttribute('aria-label');
    btn.addEventListener('click', () => {
      if (!armato) {
        armato = true; btn.classList.add('armed'); btn.textContent = testo; btn.setAttribute('aria-label', 'Conferma: ' + etichetta);
        setTimeout(() => { if (btn.isConnected && armato) { armato = false; btn.classList.remove('armed'); btn.replaceChildren(icon('x')); btn.setAttribute('aria-label', etichetta); } }, 4000);
        return;
      }
      azione();
    });
    return btn;
  }

  function card(titolo, extra, ...contenuto) {
    return h('section', { class: 'card' }, h('header', {}, h('span', { class: 'label' }, titolo), extra || null), h('div', { class: 'in' }, ...contenuto));
  }

  // ---------- panoramica ----------

  let cruscotto = null;
  function aggiornaCruscotto() {
    if (!cruscotto || !cruscotto.isConnected) return;
    cruscotto.replaceChildren(...contenutoCruscotto());
  }
  function contenutoCruscotto() {
    const b = prod.blocchi;
    const tile = (k, titolo, numero) => h('a', { class: 'tile ' + b[k].stato, href: `#/p/${prod.id}/${k}` },
      h('span', { class: 'label' }, titolo),
      h('b', {}, numero),
      h('span', { class: 'tile-stato' }, h('span', { class: 'dot ' + b[k].stato }), STATO_TESTO[b[k].stato]));
    const avvisi = prod.avvisi.length
      ? h('ul', { class: 'avvisi' }, prod.avvisi.map(a => h('li', {}, h('a', { href: `#/p/${prod.id}/${a.blocco}` }, a.testo))))
      : h('p', { class: 'help', style: { margin: 0 } }, 'Nessun avviso.');
    return [
      h('div', { class: 'tiles' },
        tile('programma', 'Programma', `${b.programma.attivita} attività · ${b.programma.giornate}/${b.struttura.giornate} ${b.struttura.giornate === 1 ? 'giornata' : 'giornate'}`),
        tile('struttura', 'Struttura', `${b.struttura.giornate} ${b.struttura.giornate === 1 ? 'giornata' : 'giornate'} · ${b.struttura.spazi} ${b.struttura.spazi === 1 ? 'spazio' : 'spazi'}`),
        tile('persone', 'Persone', `${b.persone.squadra} in squadra`)),
      card('Avvisi', h('span', { class: 'help mono' }, String(prod.avvisi.length)), avvisi)
    ];
  }

  function panoramica() {
    cruscotto = h('div', { class: 'cruscotto' }, ...contenutoCruscotto());
    const note = mod
      ? (() => {
          const ta = h('textarea', { class: 'input', 'aria-label': 'Note della produzione', placeholder: 'Indicazioni generali: accessi, parcheggio, orari di carico, referenti del luogo…' }, prod.note);
          ta.addEventListener('input', () => { prod.note = ta.value; salva('produzione', 'modifica', null, { note: ta.value }); });
          return ta;
        })()
      : h('div', { class: 'pre' }, prod.note || h('span', { class: 'help' }, 'Nessuna nota.'));
    return [
      cruscotto,
      eventiCard(),
      card('Note della produzione', null, note),
      h('p', { class: 'help' }, 'Lista materiali, artisti e channel list arrivano nelle prossime tappe di CTRL.')
    ];
  }

  function eventiCard() {
    const lista = h('div', { class: 'ev-linked' }, prod.eventi.map(e => h('div', { class: 'ev-link' },
      h('span', { class: 'bar', style: { background: e.colore } }),
      h('a', { href: '#/e/' + e.id }, h('b', {}, e.titolo), h('span', { class: 'help' }, [dateRange(e), e.luogo].filter(Boolean).join(' · '))),
      e.stato === 'annullato' ? h('span', { class: 'tag danger' }, 'Annullato') : null,
      mod && prod.eventi.length > 1 ? conferma(h('button', { class: 'iconbtn', 'aria-label': 'Togli ' + e.titolo + ' dalla scheda', title: 'Togli dalla scheda' }, icon('x')), 'Togli?', async () => {
        try { await ricarica(api('produzione.scollega', { id: prod.id, evento_id: e.id })); toast('Evento tolto dalla scheda'); } catch (err) { toast(err.message, 'err'); }
      }) : null)));
    const aggiungi = mod ? aggiungiEvento() : null;
    return card(prod.eventi.length > 1 ? 'Eventi collegati' : 'Evento collegato', h('span', { class: 'help mono' }, String(prod.eventi.length)), lista, aggiungi);
  }

  function aggiungiEvento() {
    const box = h('div', { class: 'picker' });
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Aggiungi un altro evento (festival): cerca per nome', 'aria-label': 'Cerca un evento da aggiungere' });
    const risultati = h('div', { class: 'picker-list', role: 'listbox' });
    input.addEventListener('input', async () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { risultati.replaceChildren(); return; }
      const evs = await loadEvents();
      const liberi = evs.filter(e => !e.produzione_id && (e.titolo + ' ' + (e.luogo || '')).toLowerCase().includes(q)).slice(0, 8);
      risultati.replaceChildren(...(liberi.length ? liberi.map(e => h('button', { class: 'picker-item', role: 'option', onclick: async () => {
        risultati.replaceChildren(); input.value = '';
        try {
          await ricarica(api('produzione.collega', { id: prod.id, evento_id: e.id }));
          const ev = store.events?.find(x => x.id === e.id); if (ev) ev.produzione_id = prod.id;
          toast('Evento aggiunto: giornate aggiornate');
        } catch (err) { toast(err.message, 'err'); }
      } }, h('b', {}, e.titolo), h('span', { class: 'help' }, dateRange(e)))) : [h('p', { class: 'help', style: { margin: '6px 0' } }, 'Nessun evento libero con questo nome.')]));
    });
    box.append(input, risultati);
    return box;
  }

  /** Dopo collegamenti e scollegamenti il server ricalcola le giornate: si ricarica tutto. */
  async function ricarica(promessa) {
    await saver.subito();
    const r = await promessa;
    Object.assign(prod, r);
    [...prod.giornate, ...prod.spazi, ...prod.squadra, ...prod.attivita].forEach(x => versioni.set(x.id, x.versione));
    mainEl = null;
    mostra(corrente, document.querySelector('main.prod'));
  }

  // ---------- struttura ----------

  function struttura() {
    const eventiDel = (d) => prod.eventi.filter(e => e.data <= d && (e.data_fine || e.data) >= d);
    const giornate = h('div', { class: 'list-rows' }, prod.giornate.map(g => h('div', { class: 'lrow gio' },
      h('div', { class: 'gio-data' }, h('b', {}, longDate(g.data)),
        eventiDel(g.data).length ? h('span', { class: 'help' }, eventiDel(g.data).map(e => e.titolo).join(' · ')) : h('span', { class: 'help' }, 'Nessun evento del Calendar in questa data')),
      campo(g.etichetta, v => { g.etichetta = v; salva('giornata', 'modifica', g.id, { etichetta: v }); }, { placeholder: 'es. Montaggio, Show, Smontaggio', label: 'Etichetta del ' + g.data, max: 60, vuoto: '' }),
      mod ? conferma(h('button', { class: 'iconbtn', 'aria-label': 'Togli la giornata del ' + g.data, title: 'Togli giornata' }, icon('x')), prod.attivita.some(a => a.giornata_id === g.id) ? `Togli con ${prod.attivita.filter(a => a.giornata_id === g.id).length} attività?` : 'Togli?', () => {
        prod.giornate = prod.giornate.filter(x => x !== g);
        prod.squadra.forEach(s => { if (s.giornata_id === g.id) s.giornata_id = ''; });
        prod.attivita = prod.attivita.filter(a => a.giornata_id !== g.id);
        salva('giornata', 'elimina', g.id);
        disegnaBlocco();
      }) : null)));
    let aggiungiG = null;
    if (mod) {
      const d = h('input', { class: 'input', type: 'date', 'aria-label': 'Data della nuova giornata' });
      const err = h('span', { class: 'status-line err' });
      aggiungiG = h('div', { class: 'add-row' }, d, h('button', { class: 'btn', onclick: () => {
        if (!d.value) { err.textContent = 'Scegli una data.'; return; }
        if (prod.giornate.some(g => g.data === d.value)) { err.textContent = 'C\'è già una giornata in questa data.'; return; }
        const g = { id: nuovoId('gio'), data: d.value, etichetta: '', ordine: '0' };
        prod.giornate = [...prod.giornate, g].sort((a, b) => a.data.localeCompare(b.data));
        salva('giornata', 'crea', g.id, { data: g.data });
        disegnaBlocco();
      } }, icon('plus'), 'Aggiungi giornata'), err);
    }

    const spazi = h('div', { class: 'list-rows' }, prod.spazi.map((s, i) => h('div', { class: 'lrow spa' },
      h('div', { class: 'spa-campi' },
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Nome'), campo(s.nome, v => { s.nome = v; salva('spazio', 'modifica', s.id, { nome: v }); }, { richiesto: true, label: 'Nome dello spazio', max: 80 })),
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Tipo'), scelta(s.tipo || 'altro', TIPI_SPAZIO, v => { s.tipo = v; salva('spazio', 'modifica', s.id, { tipo: v }); }, 'Tipo di spazio')),
        h('label', { class: 'cell wide' }, h('span', { class: 'cell-l' }, 'Indirizzo o posizione'), campo(s.indirizzo, v => { s.indirizzo = v; salva('spazio', 'modifica', s.id, { indirizzo: v }); }, { label: 'Indirizzo dello spazio', placeholder: 'es. Via Libertini 1, oppure "cortile interno"' })),
        h('label', { class: 'cell wide' }, h('span', { class: 'cell-l' }, 'Note'), campo(s.note, v => { s.note = v; salva('spazio', 'modifica', s.id, { note: v }); }, { label: 'Note dello spazio', placeholder: 'Accesso, corrente, dimensioni…', max: 1000 }))),
      mod ? h('div', { class: 'rtools' },
        h('button', { class: 'iconbtn', 'aria-label': 'Sposta su ' + s.nome, title: 'Sposta su', disabled: i === 0, onclick: () => sposta(i, -1) }, icon('up')),
        h('button', { class: 'iconbtn', 'aria-label': 'Sposta giù ' + s.nome, title: 'Sposta giù', disabled: i === prod.spazi.length - 1, onclick: () => sposta(i, 1) }, icon('down')),
        conferma(h('button', { class: 'iconbtn', 'aria-label': 'Togli lo spazio ' + s.nome, title: 'Togli spazio' }, icon('x')), 'Togli?', () => {
          prod.spazi = prod.spazi.filter(x => x !== s);
          prod.squadra.forEach(m => { if (m.spazio_id === s.id) m.spazio_id = ''; });
          prod.attivita.forEach(a => { if (a.spazio_id === s.id) a.spazio_id = ''; });
          salva('spazio', 'elimina', s.id);
          disegnaBlocco();
        })) : null)));

    function sposta(i, d) {
      const arr = prod.spazi;
      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
      arr.forEach((s, j) => { const o = String(j + 1); if (s.ordine !== o) { s.ordine = o; salva('spazio', 'modifica', s.id, { ordine: o }); } });
      disegnaBlocco();
    }

    let aggiungiS = null;
    if (mod) {
      const n = h('input', { class: 'input', placeholder: 'Nome del nuovo spazio (palco, sala, magazzino…)', 'aria-label': 'Nome del nuovo spazio', maxlength: 80 });
      const add = () => {
        const v = n.value.trim();
        if (!v) { n.setAttribute('aria-invalid', 'true'); n.focus(); return; }
        const s = { id: nuovoId('spa'), nome: v, tipo: 'altro', indirizzo: '', note: '', ordine: String(prod.spazi.length + 1) };
        prod.spazi = [...prod.spazi, s];
        salva('spazio', 'crea', s.id, { nome: s.nome, tipo: s.tipo, ordine: s.ordine });
        disegnaBlocco();
      };
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      aggiungiS = h('div', { class: 'add-row' }, n, h('button', { class: 'btn', onclick: add }, icon('plus'), 'Aggiungi spazio'));
    }

    return [
      card('Giornate', h('span', { class: 'help mono' }, String(prod.giornate.length)),
        prod.giornate.length ? giornate : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuna giornata.'),
        aggiungiG,
        h('p', { class: 'help', style: { margin: 0 } }, 'Le giornate partono dalle date degli eventi del Calendar. Aggiungi quelle di montaggio o smontaggio.')),
      card('Spazi', h('span', { class: 'help mono' }, String(prod.spazi.length)),
        prod.spazi.length ? spazi : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuno spazio.'),
        aggiungiS)
    ];
  }

  // ---------- persone ----------

  function persone() {
    const opzGiornate = [['', 'Tutte le giornate'], ...prod.giornate.map(g => [g.id, shortDate(g.data) + (g.etichetta ? ' · ' + g.etichetta : '')])];
    const opzSpazi = [['', 'Tutti gli spazi'], ...prod.spazi.map(s => [s.id, s.nome])];

    const righe = h('div', { class: 'list-rows' }, prod.squadra.map(m => membro(m, opzGiornate, opzSpazi)));
    const out = [card('Squadra', h('span', { class: 'help mono' }, String(prod.squadra.length)),
      prod.squadra.length ? righe : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuno in squadra.'),
      mod ? aggiungiPersona() : null)];
    out.push(h('p', { class: 'help' }, 'Le persone stanno in una rubrica comune a tutti gli eventi: un contatto si scrive una volta sola.'));
    return out;
  }

  function membro(m, opzGiornate, opzSpazi) {
    const p = m.persona || { nome: '(persona non trovata)' };
    const contatti = h('div', { class: 'contatti' },
      p.telefono ? h('a', { href: 'tel:' + p.telefono.replace(/[^\d+]/g, ''), class: 'mono' }, p.telefono) : h('span', { class: 'help' }, 'senza telefono'),
      p.email ? h('a', { href: 'mailto:' + p.email }, p.email) : null);
    const testa = h('div', { class: 'mem-head' },
      h('b', {}, p.nome), p.eliminata ? h('span', { class: 'tag danger' }, 'Tolta dalla rubrica') : null,
      h('span', { class: 'help' }, [p.ruolo, p.azienda].filter(Boolean).join(' · ')), contatti);
    const form = h('div', { class: 'mem-edit', hidden: true });
    const campi = h('div', { class: 'spa-campi' },
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Ruolo in questo evento'), campo(m.ruolo, v => { m.ruolo = v; salva('squadra', 'modifica', m.id, { ruolo: v }); }, { label: 'Ruolo di ' + p.nome + ' in questo evento', placeholder: p.ruolo || 'es. Fonico di palco', max: 80 })),
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Giornata'), scelta(m.giornata_id || '', opzGiornate, v => { m.giornata_id = v; salva('squadra', 'modifica', m.id, { giornata_id: v }); }, 'Giornata di ' + p.nome)),
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Spazio'), scelta(m.spazio_id || '', opzSpazi, v => { m.spazio_id = v; salva('squadra', 'modifica', m.id, { spazio_id: v }); }, 'Spazio di ' + p.nome)),
      h('label', { class: 'cell wide' }, h('span', { class: 'cell-l' }, 'Note'), campo(m.note, v => { m.note = v; salva('squadra', 'modifica', m.id, { note: v }); }, { label: 'Note su ' + p.nome, max: 500 })));
    const strumenti = mod ? h('div', { class: 'rtools' },
      m.persona && !p.eliminata ? h('button', { class: 'btn ghost', onclick: () => { form.hidden = !form.hidden; if (!form.hidden && !form.childNodes.length) form.append(...contatto(m.persona)); } }, icon('edit'), 'Contatto') : null,
      conferma(h('button', { class: 'iconbtn', 'aria-label': 'Togli ' + p.nome + ' dalla squadra', title: 'Togli dalla squadra' }, icon('x')), 'Togli?', () => {
        prod.squadra = prod.squadra.filter(x => x !== m);
        salva('squadra', 'elimina', m.id);
        disegnaBlocco();
      })) : null;
    return h('div', { class: 'lrow mem' }, testa, campi, strumenti, form);
  }

  /** Dati della persona nella rubrica: valgono per tutti gli eventi. */
  function contatto(per) {
    const set = (k) => (v) => {
      per[k] = v;
      prod.squadra.forEach(m => { if (m.persona_id === per.id) m.persona = per; });
      salva('persona', 'modifica', per.id, { [k]: v });
    };
    return [
      h('p', { class: 'help', style: { margin: 0 } }, 'Questi dati sono nella rubrica: valgono per tutti gli eventi.'),
      h('div', { class: 'spa-campi' },
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Nome'), campo(per.nome, set('nome'), { richiesto: true, label: 'Nome in rubrica', max: 80 })),
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Ruolo abituale'), campo(per.ruolo, set('ruolo'), { label: 'Ruolo abituale', max: 80 })),
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Telefono'), campo(per.telefono, set('telefono'), { label: 'Telefono', type: 'tel', max: 30 })),
        h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Email'), emailCampo(per.email, set('email'))),
        h('label', { class: 'cell wide' }, h('span', { class: 'cell-l' }, 'Azienda o service'), campo(per.azienda, set('azienda'), { label: 'Azienda', max: 80 })))
    ];
  }

  function emailCampo(valore, onValore) {
    const el = campo(valore, () => {}, { label: 'Email', type: 'email', max: 120 });
    el.addEventListener('input', () => {
      const v = el.value.trim();
      const okEmail = !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
      el.setAttribute('aria-invalid', okEmail ? 'false' : 'true');
      if (okEmail) onValore(v);
    });
    return el;
  }

  function aggiungiPersona() {
    const box = h('div', { class: 'picker' });
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Aggiungi persona: cerca nella rubrica o scrivi un nome nuovo', 'aria-label': 'Cerca o aggiungi una persona', autocomplete: 'off' });
    const risultati = h('div', { class: 'picker-list', role: 'listbox' });
    const nuova = h('div', { class: 'mem-new', hidden: true });

    async function carica() {
      if (rubrica) return rubrica;
      try { rubrica = await api('persone.list', {}); } catch { rubrica = []; }
      return rubrica;
    }

    function aggiungi(per, nuovaPersona) {
      const m = { id: nuovoId('sq'), persona_id: per.id, ruolo: per.ruolo || '', giornata_id: '', spazio_id: '', note: '', ordine: String(prod.squadra.length + 1), persona: per };
      if (nuovaPersona) {
        salva('persona', 'crea', per.id, { nome: per.nome, ruolo: per.ruolo, telefono: per.telefono, email: per.email, azienda: per.azienda });
        rubrica = rubrica ? [...rubrica, per] : null;
      }
      salva('squadra', 'crea', m.id, { persona_id: per.id, ruolo: m.ruolo, ordine: m.ordine });
      prod.squadra = [...prod.squadra, m];
      disegnaBlocco();
      toast(per.nome + ' aggiunto alla squadra');
    }

    input.addEventListener('focus', carica, { once: true });
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      nuova.hidden = true;
      if (!q) { risultati.replaceChildren(); return; }
      const lista = await carica();
      const presenti = new Set(prod.squadra.map(m => m.persona_id));
      const ql = q.toLowerCase();
      const trovati = lista.filter(p => !presenti.has(p.id) && [p.nome, p.ruolo, p.azienda].join(' ').toLowerCase().includes(ql)).slice(0, 8);
      risultati.replaceChildren(
        ...trovati.map(p => h('button', { class: 'picker-item', role: 'option', onclick: () => aggiungi(p, false) },
          h('b', {}, p.nome), h('span', { class: 'help' }, [p.ruolo, p.azienda, p.telefono].filter(Boolean).join(' · ')))),
        h('button', { class: 'picker-item nuovo', role: 'option', onclick: () => apriNuova(q) }, icon('plus'), h('span', {}, `Nuova persona «${q}»`)));
    });

    function apriNuova(nome) {
      risultati.replaceChildren();
      const per = { id: nuovoId('per'), nome, ruolo: '', telefono: '', email: '', azienda: '', note: '' };
      const err = h('span', { class: 'status-line err' });
      const f = {
        nome: h('input', { class: 'input', value: nome, 'aria-label': 'Nome', maxlength: 80 }),
        ruolo: h('input', { class: 'input', 'aria-label': 'Ruolo', placeholder: 'es. Fonico, Tecnico luci, Facchino', maxlength: 80 }),
        telefono: h('input', { class: 'input', type: 'tel', 'aria-label': 'Telefono', maxlength: 30 }),
        email: h('input', { class: 'input', type: 'email', 'aria-label': 'Email', maxlength: 120 }),
        azienda: h('input', { class: 'input', 'aria-label': 'Azienda o service', maxlength: 80 })
      };
      nuova.replaceChildren(
        h('div', { class: 'spa-campi' },
          ...[['nome', 'Nome *'], ['ruolo', 'Ruolo'], ['telefono', 'Telefono'], ['email', 'Email'], ['azienda', 'Azienda o service']]
            .map(([k, l]) => h('label', { class: 'cell' + (k === 'azienda' ? ' wide' : '') }, h('span', { class: 'cell-l' }, l), f[k]))),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { nuova.hidden = true; input.value = ''; } }, 'Annulla'),
          h('button', { class: 'btn primary', onclick: () => {
            Object.keys(f).forEach(k => { per[k] = f[k].value.trim(); });
            if (!per.nome) { err.textContent = 'Il nome è obbligatorio.'; return; }
            if (per.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(per.email)) { err.textContent = 'Email non valida.'; return; }
            aggiungi(per, true);
          } }, 'Aggiungi alla squadra'), err));
      nuova.hidden = false;
      f.ruolo.focus();
    }

    box.append(input, risultati, nuova);
    return box;
  }

  return { id: prod.id, saver, mostra };
}
