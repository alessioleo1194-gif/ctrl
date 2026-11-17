import { h, icon, toast } from '../ui.js';
import { shortDate } from '../format.js';
import { nuovoId } from '../autosave.js';
import Programma from '../programma.js';
import { normalizzaOra, sommaMinuti } from '../orari.js';
import { documentoProgramma } from './documento.js';

/**
 * Programma della produzione (Production Schedule).
 * Si compila in una tabella, una giornata alla volta: ogni campo si salva da solo.
 * L'ordine è sempre cronologico; le frecce ordinano solo le attività con lo stesso orario.
 *
 * ctx: { prod, mod, salva, card, conferma, stato, ridisegna }
 *   stato è conservato tra un disegno e l'altro: { giorno, vista, doc }
 */
export function bloccoProgramma(ctx) {
  const { prod, mod, card, stato } = ctx;
  if (!prod.giornate.length) {
    return [card('Programma', null,
      h('p', { class: 'help', style: { margin: 0 } }, 'Il programma si compila per giornate e questa scheda non ne ha.'),
      h('a', { class: 'btn', href: `#/p/${prod.id}/struttura` }, 'Aggiungi una giornata in Struttura'))];
  }
  if (!prod.giornate.some(g => g.id === stato.giorno)) stato.giorno = prod.giornate[0].id;
  if (!mod) stato.vista = 'documento';
  if (!stato.vista) stato.vista = 'modifica';

  const commuta = mod ? h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Vista del programma' },
    ...[['modifica', 'Compila'], ['documento', 'Documento e PDF']].map(([k, l]) => h('button', {
      class: 'seg-b', role: 'tab', 'aria-selected': stato.vista === k ? 'true' : 'false',
      onclick: () => { if (stato.vista !== k) { stato.vista = k; ctx.ridisegna(); } }
    }, l))) : null;

  if (stato.vista === 'documento') return [commuta, ...documentoProgramma(ctx)].filter(Boolean);
  return [commuta, ...compila(ctx)];
}

function compila(ctx) {
  const { prod, salva, card, conferma, stato } = ctx;
  const g = prod.giornate.find(x => x.id === stato.giorno);
  const delGiorno = () => Programma.ordina(prod.attivita.filter(a => a.giornata_id === g.id));
  const listaResp = 'resp-' + prod.id;
  const datalist = h('datalist', { id: listaResp });

  // ---------- giornate ----------
  const schede = h('div', { class: 'day-tabs', role: 'tablist', 'aria-label': 'Giornate' });
  function disegnaSchede() {
    schede.replaceChildren(...prod.giornate.map(x => {
      const n = prod.attivita.filter(a => a.giornata_id === x.id).length;
      return h('button', {
        class: 'day-tab', role: 'tab', 'aria-selected': x.id === g.id ? 'true' : 'false',
        onclick: () => { if (x.id !== g.id) { stato.giorno = x.id; ctx.ridisegna(); } }
      }, h('b', {}, shortDate(x.data)), x.etichetta ? h('span', {}, x.etichetta) : null,
      h('span', { class: 'count', 'aria-label': n + ' attività' }, String(n)));
    }));
  }

  // ---------- tabella ----------
  const tabella = h('div', { class: 'sched', role: 'table', 'aria-label': 'Programma del ' + g.data });
  const avvisiBox = h('div', { class: 'sched-avvisi', role: 'status', 'aria-live': 'polite' });
  const testata = h('div', { class: 'srow shead', role: 'row' },
    ...['Start', 'End', 'Activity', 'Location', 'Responsible', 'Details / Notes', ''].map(t => h('span', { role: 'columnheader' }, t)));

  const vuoto = h('p', { class: 'help', style: { margin: 0 } }, 'Nessuna attività in questa giornata. Aggiungi la prima: orari come 1630 o 16:30, Invio per passare alla riga successiva.');
  const contatore = h('span', { class: 'help mono' });

  const elementi = new Map(); // id attività → riga
  let firmaSpazi = prod.spazi.map(x => x.id + x.nome).join('|');

  function disegna(fuoco) {
    // conserva il campo attivo anche se la riga cambia posizione
    const att = document.activeElement;
    const tieni = fuoco || (att && att.dataset && att.dataset.f && att.closest('.srow')
      ? { id: att.closest('.srow').dataset.id, f: att.dataset.f } : null);
    const lista = delGiorno();
    // le righe esistenti si spostano, non si ricreano: un campo che stai scrivendo non perde il testo
    const vive = new Set(lista.map(a => a.id));
    [...elementi.keys()].forEach(id => { if (!vive.has(id)) { elementi.get(id).remove(); elementi.delete(id); } });
    const firma = prod.spazi.map(x => x.id + x.nome).join('|');
    const spaziCambiati = firma !== firmaSpazi;
    firmaSpazi = firma;
    const voluti = [testata, ...lista.map(a => {
      let el = elementi.get(a.id);
      if (!el) { el = riga(a); elementi.set(a.id, el); } else if (spaziCambiati) el._spazi();
      return el;
    })];
    const ora = [...tabella.children];
    if (voluti.length !== ora.length || voluti.some((el, i) => el !== ora[i])) tabella.append(...voluti);
    lista.forEach((a, i) => {
      const el = elementi.get(a.id);
      el.setAttribute('aria-label', `Attività ${i + 1}`);
      const pari = (j) => lista[j] && (lista[j].ora_inizio || '') === (a.ora_inizio || '');
      el.querySelector('[data-f="su"]').disabled = !pari(i - 1);
      el.querySelector('[data-f="giu"]').disabled = !pari(i + 1);
    });
    datalist.replaceChildren(...suggerimenti().map(v => h('option', { value: v })));
    aggiornaAvvisi();
    disegnaSchede();
    vuoto.hidden = lista.length > 0;
    tabella.hidden = lista.length === 0;
    contatore.textContent = lista.length + ' attività';
    if (tieni) {
      const el = tabella.querySelector(`.srow[data-id="${tieni.id}"] [data-f="${tieni.f}"]`);
      if (el) el.focus();
    }
  }

  function suggerimenti() {
    const s = new Set();
    prod.squadra.forEach(m => { if (m.persona && m.persona.nome) s.add(m.persona.nome); });
    prod.attivita.forEach(a => { if (a.responsabile) s.add(a.responsabile); });
    return [...s].sort((a, b) => a.localeCompare(b, 'it'));
  }

  function aggiornaAvvisi() {
    const lista = delGiorno();
    const coinvolte = new Set();
    Programma.sovrapposizioni(lista).forEach(c => { coinvolte.add(c.a); coinvolte.add(c.b); });
    tabella.querySelectorAll('.srow[data-id]').forEach(r => r.classList.toggle('conflitto', coinvolte.has(r.dataset.id)));
    const avvisi = Programma.avvisi([g], lista);
    avvisiBox.replaceChildren(...(avvisi.length ? [h('ul', { class: 'avvisi warn' }, avvisi.map(a => h('li', {}, icon('warn'), a.testo.replace(/^\d\d\/\d\d: /, ''))))] : []));
  }

  function prossimoOrdine() {
    return String(prod.attivita.filter(a => a.giornata_id === g.id).reduce((m, a) => Math.max(m, parseInt(a.ordine, 10) || 0), 0) + 1);
  }

  function nuova(base) {
    const a = {
      id: nuovoId('att'), giornata_id: g.id, ora_inizio: '', ora_fine: '', tipo: '', attivita: '',
      spazio_id: '', responsabile: '', note: '', ordine: prossimoOrdine(), ...base
    };
    prod.attivita.push(a);
    const campi = {};
    ['giornata_id', 'ora_inizio', 'ora_fine', 'tipo', 'attivita', 'spazio_id', 'responsabile', 'note', 'ordine'].forEach(k => { if (a[k]) campi[k] = a[k]; });
    salva('attivita', 'crea', a.id, campi);
    return a;
  }

  function aggiungi() {
    const lista = delGiorno();
    const ultima = lista.filter(a => a.ora_inizio).at(-1);
    const a = nuova({ ora_inizio: ultima ? (ultima.ora_fine || '') : '' });
    disegna({ id: a.id, f: a.ora_inizio ? 'tipo' : 'inizio' });
  }

  function duplica(a) {
    let inizio = a.ora_fine || a.ora_inizio, fine = '';
    const iv = Programma.intervallo(a);
    if (a.ora_fine && iv && iv.e !== null) fine = sommaMinuti(a.ora_fine, iv.e - iv.s);
    const b = nuova({ ora_inizio: inizio, ora_fine: fine, tipo: a.tipo, attivita: a.attivita, spazio_id: a.spazio_id, responsabile: a.responsabile, note: a.note });
    disegna({ id: b.id, f: 'inizio' });
    toast('Attività duplicata');
  }

  function scambia(a, d) {
    const lista = delGiorno();
    const i = lista.indexOf(a), j = i + d;
    const b = lista[j];
    if (!b || (b.ora_inizio || '') !== (a.ora_inizio || '')) return;
    let oa = parseInt(a.ordine, 10) || 0, ob = parseInt(b.ordine, 10) || 0;
    if (oa === ob) { ob = oa + 1; }
    [a.ordine, b.ordine] = [String(ob), String(oa)];
    salva('attivita', 'modifica', a.id, { ordine: a.ordine });
    salva('attivita', 'modifica', b.id, { ordine: b.ordine });
    disegna({ id: a.id, f: d < 0 ? 'su' : 'giu' });
  }

  function cambia(a, k, v) {
    a[k] = v;
    salva('attivita', 'modifica', a.id, { [k]: v });
  }

  // ---------- riga ----------
  function oraCampo(a, k, f, etichetta) {
    const el = h('input', { class: 'input ora mono', value: a[k], placeholder: 'hh:mm', inputmode: 'numeric', autocomplete: 'off', maxlength: 5, 'aria-label': etichetta, 'data-f': f });
    // mentre scrivi: un orario riconoscibile si salva subito e aggiorna gli avvisi
    el.addEventListener('input', () => {
      const v = normalizzaOra(el.value);
      if (v === null || v === a[k]) return;
      cambia(a, k, v);
      aggiornaAvvisi();
    });
    // quando lasci il campo: si scrive in forma hh:mm e la riga va al suo posto
    el.addEventListener('change', () => {
      const v = normalizzaOra(el.value);
      if (v === null) { el.setAttribute('aria-invalid', 'true'); toast(`"${el.value}" non è un orario: scrivi per esempio 1630 o 16:30`, 'err'); return; }
      el.removeAttribute('aria-invalid');
      el.value = v;
      if (v !== a[k]) cambia(a, k, v);
      if (k === 'ora_inizio') setTimeout(() => disegna(), 0); else aggiornaAvvisi();
    });
    return el;
  }

  function attivitaCampo(a) {
    const opzioni = [['', 'Scegli…'], ...prod.catalogo_attivita.map(x => [x, x]), [Programma.CUSTOM, 'Custom Activity…']];
    if (a.tipo && a.tipo !== Programma.CUSTOM && !prod.catalogo_attivita.includes(a.tipo)) opzioni.splice(1, 0, [a.tipo, a.tipo]);
    const sel = h('select', { class: 'input', 'aria-label': 'Activity', 'data-f': 'tipo' }, opzioni.map(([v, l]) => h('option', { value: v, selected: v === (a.tipo || '') }, l)));
    const libero = h('input', { class: 'input', value: a.attivita, placeholder: 'Nome dell\'attività', maxlength: 80, 'aria-label': 'Nome attività personalizzata', 'data-f': 'custom', hidden: a.tipo !== Programma.CUSTOM });
    sel.addEventListener('change', () => {
      cambia(a, 'tipo', sel.value);
      libero.hidden = sel.value !== Programma.CUSTOM;
      if (!libero.hidden) libero.focus();
      aggiornaAvvisi();
    });
    libero.addEventListener('input', () => { cambia(a, 'attivita', libero.value.trim()); });
    libero.addEventListener('change', aggiornaAvvisi);
    return h('div', { class: 'cella-att' }, sel, libero);
  }

  function spazioCampo(a) {
    const box = h('div', { class: 'cella-spa' });
    const disegnaSel = () => {
      const sel = h('select', { class: 'input', 'aria-label': 'Location', 'data-f': 'spazio' },
        h('option', { value: '', selected: !a.spazio_id }, '—'),
        ...prod.spazi.map(s => h('option', { value: s.id, selected: s.id === a.spazio_id }, s.nome)),
        h('option', { value: '__nuovo' }, '+ Nuovo spazio…'));
      sel.addEventListener('change', () => {
        if (sel.value === '__nuovo') return nuovoSpazio();
        cambia(a, 'spazio_id', sel.value);
        aggiornaAvvisi();
      });
      box.replaceChildren(sel);
      return sel;
    };
    function nuovoSpazio() {
      const inp = h('input', { class: 'input', placeholder: 'Nome dello spazio, poi Invio', maxlength: 80, 'aria-label': 'Nome del nuovo spazio', 'data-f': 'spazio-nuovo' });
      let fatto = false;
      const chiudi = (crea) => {
        if (fatto) return;
        fatto = true;
        const nome = inp.value.trim();
        if (crea && nome) {
          const esiste = prod.spazi.find(s => s.nome.toLowerCase() === nome.toLowerCase());
          let s = esiste;
          if (!s) {
            s = { id: nuovoId('spa'), nome, tipo: 'altro', indirizzo: '', note: '', ordine: String(prod.spazi.length + 1) };
            prod.spazi.push(s);
            salva('spazio', 'crea', s.id, { nome: s.nome, tipo: s.tipo, ordine: s.ordine });
            toast(`Spazio "${nome}" aggiunto alla struttura`);
          }
          cambia(a, 'spazio_id', s.id);
          disegnaSel();
          disegna({ id: a.id, f: 'resp' });
          return;
        }
        disegnaSel().focus();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); chiudi(true); }
        if (e.key === 'Escape') { e.preventDefault(); chiudi(false); }
      });
      inp.addEventListener('blur', () => chiudi(true));
      box.replaceChildren(inp);
      inp.focus();
    }
    disegnaSel();
    // quando cambiano gli spazi (uno nuovo da un'altra riga) si aggiornano le opzioni, se non stai scrivendo qui
    box._spazi = () => { if (!box.contains(document.activeElement)) disegnaSel(); };
    return box;
  }

  function riga(a) {
    const resp = h('input', { class: 'input', value: a.responsabile, list: listaResp, maxlength: 120, autocomplete: 'off', placeholder: 'Chi', 'aria-label': 'Responsible', 'data-f': 'resp' });
    resp.addEventListener('input', () => cambia(a, 'responsabile', resp.value.trim()));
    resp.addEventListener('change', aggiornaAvvisi);
    const note = h('textarea', { class: 'input note', rows: 1, maxlength: 2000, placeholder: 'Dettagli operativi', 'aria-label': 'Details / Notes', 'data-f': 'note' }, a.note);
    note.addEventListener('input', () => cambia(a, 'note', note.value));

    const cellaSpazio = spazioCampo(a);
    const r = h('div', { class: 'srow', role: 'row', 'data-id': a.id },
      h('span', { class: 'c-ini', role: 'cell' }, oraCampo(a, 'ora_inizio', 'inizio', 'Start')),
      h('span', { class: 'c-fin', role: 'cell' }, oraCampo(a, 'ora_fine', 'fine', 'End')),
      h('span', { class: 'c-att', role: 'cell' }, attivitaCampo(a)),
      h('span', { class: 'c-spa', role: 'cell' }, cellaSpazio),
      h('span', { class: 'c-res', role: 'cell' }, resp),
      h('span', { class: 'c-not', role: 'cell' }, note),
      h('span', { class: 'c-str rtools', role: 'cell' },
        h('button', { class: 'iconbtn', 'aria-label': 'Sposta su', title: 'Sposta su (stesso orario)', 'data-f': 'su', onclick: () => scambia(a, -1) }, icon('up')),
        h('button', { class: 'iconbtn', 'aria-label': 'Sposta giù', title: 'Sposta giù (stesso orario)', 'data-f': 'giu', onclick: () => scambia(a, 1) }, icon('down')),
        h('button', { class: 'iconbtn', 'aria-label': 'Duplica', title: 'Duplica', onclick: () => duplica(a) }, icon('copy')),
        conferma(h('button', { class: 'iconbtn', 'aria-label': 'Togli attività', title: 'Togli' }, icon('x')), 'Togli?', () => {
          prod.attivita = prod.attivita.filter(x => x !== a);
          salva('attivita', 'elimina', a.id);
          disegna();
        })));
    r._spazi = () => cellaSpazio._spazi();

    // Invio: passa alla riga sotto; sull'ultima riga aggiunge un'attività
    r.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT' || e.target.dataset.f === 'spazio-nuovo') return;
      e.preventDefault();
      e.target.dispatchEvent(new Event('change'));
      const f = e.target.dataset.f;
      const righe = [...tabella.querySelectorAll('.srow[data-id]')];
      const pos = righe.findIndex(x => x.dataset.id === a.id);
      setTimeout(() => {
        const dopo = [...tabella.querySelectorAll('.srow[data-id]')];
        const qui = dopo.findIndex(x => x.dataset.id === a.id);
        if (qui === dopo.length - 1 || pos === righe.length - 1) aggiungi();
        else dopo[qui + 1].querySelector(`[data-f="${f}"]`)?.focus();
      }, 10);
    });
    return r;
  }

  // ---------- note della giornata ----------
  const noteG = h('textarea', { class: 'input', 'aria-label': 'Note della giornata', placeholder: 'Indicazioni generali per questa giornata: accessi, parcheggio, contatti del luogo, cambi di programma…', maxlength: 2000 }, g.note || '');
  noteG.addEventListener('input', () => { g.note = noteG.value; salva('giornata', 'modifica', g.id, { note: noteG.value }); });

  const aggiungiBtn = h('button', { class: 'btn primary', onclick: aggiungi }, icon('plus'), 'Add Activity');
  disegna();
  return [
    schede,
    card(`Production Schedule · ${shortDate(g.data)}${g.etichetta ? ' · ' + g.etichetta : ''}`, contatore,
      h('div', { class: 'sched-wrap' }, tabella), datalist, vuoto,
      h('div', { class: 'row' }, aggiungiBtn),
      avvisiBox),
    card('Note della giornata', null, noteG)
  ];
}
