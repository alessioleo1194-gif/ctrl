import { h, icon, toast } from '../ui.js';
import { datiDocumento, nomeFile } from '../documento-dati.js';
import { creaPdf } from '../pdf.js';

/**
 * Production Schedule come documento: anteprima sul sito, PDF scaricabile e stampa.
 * L'anteprima e il PDF usano gli stessi dati (documento-dati.js).
 */
export function documentoProgramma(ctx) {
  const { prod, stato } = ctx;
  stato.doc = stato.doc || { lingua: 'it', giorno: '', contatti: prod.squadra.length > 0 };
  const o = stato.doc;

  const foglio = h('article', { class: 'doc', 'aria-label': 'Anteprima del documento' });
  const disegna = () => foglio.replaceChildren(...paginaHtml(datiDocumento(prod, o)));

  const lingua = h('select', { class: 'input', 'aria-label': 'Lingua del documento' },
    h('option', { value: 'it', selected: o.lingua === 'it' }, 'Italiano'),
    h('option', { value: 'en', selected: o.lingua === 'en' }, 'English'));
  lingua.addEventListener('change', () => { o.lingua = lingua.value; disegna(); });

  const giorno = h('select', { class: 'input', 'aria-label': 'Giornate nel documento' },
    h('option', { value: '', selected: !o.giorno }, prod.giornate.length > 1 ? 'Tutte le giornate' : 'La giornata'),
    ...(prod.giornate.length > 1 ? prod.giornate.map(g => h('option', { value: g.id, selected: o.giorno === g.id }, g.data.split('-').reverse().join('/') + (g.etichetta ? ' · ' + g.etichetta : ''))) : []));
  giorno.addEventListener('change', () => { o.giorno = giorno.value; disegna(); });

  const contatti = h('input', { type: 'checkbox', checked: o.contatti, 'aria-label': 'Includi i contatti della squadra' });
  contatti.addEventListener('change', () => { o.contatti = contatti.checked; disegna(); });

  const scarica = h('button', { class: 'btn primary', onclick: async () => {
    scarica.disabled = true;
    try {
      // salva prima ciò che è in sospeso: il documento deve corrispondere a quanto è sul server
      if (ctx.saver) await ctx.saver.subito();
      const doc = datiDocumento(prod, o);
      const giornate = prod.giornate.filter(g => !o.giorno || g.id === o.giorno);
      await creaPdf(doc, nomeFile(prod, doc, giornate));
    } catch (e) {
      toast('PDF non creato: ' + e.message, 'err');
    } finally {
      scarica.disabled = false;
    }
  } }, icon('download'), 'Scarica PDF');

  const stampa = h('button', { class: 'btn', onclick: () => window.print() }, icon('print'), 'Stampa');

  disegna();
  return [
    h('div', { class: 'doc-tools' },
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Lingua'), lingua),
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Giornate'), giorno),
      h('label', { class: 'check' }, contatti, h('span', {}, 'Contatti della squadra')),
      h('div', { class: 'row doc-azioni' }, stampa, scarica)),
    h('div', { class: 'doc-wrap' }, foglio)
  ];
}

function tabella(colonne, righe, cls) {
  return h('div', { class: 'doc-tab-wrap' }, h('table', { class: 'doc-tab ' + (cls || '') },
    h('thead', {}, h('tr', {}, colonne.map(c => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, righe.map(r => h('tr', {}, r.map((c, i) => h('td', { class: i === 0 && cls === 'prog' ? 'ora' : null }, c)))))));
}

function paginaHtml(d) {
  const out = [
    h('h1', {}, d.titolo),
    h('dl', { class: 'doc-head' }, d.intestazione.map(([k, v]) => h('div', {}, h('dt', {}, k + ':'), h('dd', {}, v))))
  ];
  d.giorni.forEach(g => {
    out.push(h('h2', {}, g.titolo));
    out.push(g.righe.length ? tabella(d.T.colonne, g.righe, 'prog') : h('p', { class: 'doc-vuoto' }, d.T.vuoto));
    if (g.note) out.push(h('div', { class: 'doc-note' }, h('b', {}, d.T.noteGiorno + ': '), g.note));
  });
  if (d.contatti.length) {
    out.push(h('h2', {}, d.T.contatti));
    out.push(tabella(d.T.colContatti, d.contatti, 'cont'));
  }
  out.push(h('p', { class: 'doc-piede' }, d.aggiornato));
  return out;
}
