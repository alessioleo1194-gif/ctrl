import { h, icon, toast } from '../ui.js';
import { nomeFile, testoDocumento } from '../documento-dati.js';
import { creaPdf } from '../pdf.js';

/** Documento finale: anteprima identica al PDF, con Copy Text, Print / Save PDF e Download PDF. */
export function disegnaDocumento(d) {
  const tab = (colonne, righe, cls) => h('div', { class: 'doc-tab-wrap' }, h('table', { class: 'doc-tab ' + (cls || '') },
    h('thead', {}, h('tr', {}, colonne.map(c => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, righe)));
  const riga = (r, cls) => h('tr', {}, r.map((c, i) => h('td', { class: i === 0 && cls === 'ora' ? 'ora' : (cls === 'qta' && i === 1 ? 'qta' : null) }, c)));
  const banda = (nome, n) => h('tr', { class: 'doc-banda' }, h('td', { colspan: n }, nome.toUpperCase()));

  const out = [
    h('h1', {}, d.titolo),
    h('dl', { class: 'doc-head' }, d.intestazione.map(([k, v]) => h('div', {}, h('dt', {}, k + ':'), h('dd', {}, v))))
  ];
  if (d.tipo === 'plan') {
    if (d.crew.length) { out.push(h('h2', {}, d.crewTitolo)); out.push(tab(d.colCrew, d.crew.map(r => riga(r)))); }
    out.push(h('h2', {}, d.scheduleTitolo));
    d.giorni.forEach(g => {
      if (g.titolo) out.push(h('h3', {}, g.titolo));
      if (!g.sezioni.length) { out.push(h('p', { class: 'doc-vuoto' }, d.T.vuoto)); return; }
      const righe = [];
      g.sezioni.forEach(s => { righe.push(banda(s.nome, 4)); s.righe.forEach(r => righe.push(riga(r, 'ora'))); });
      out.push(tab(d.colSchedule, righe, 'prog'));
    });
  } else {
    if (!d.sezioni.length) out.push(h('p', { class: 'doc-vuoto' }, d.T.vuotoM));
    d.sezioni.forEach(s => { out.push(h('h2', {}, s.nome)); out.push(tab(d.colonne, s.righe.map(r => riga(r, 'qta')), 'mat')); });
  }
  out.push(h('p', { class: 'doc-piede' }, d.aggiornato));
  return h('article', { class: 'doc', 'aria-label': 'Anteprima del documento' }, out);
}

async function copia(testo) {
  try { await navigator.clipboard.writeText(testo); return true; } catch { /* ripiego sotto */ }
  const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, testo);
  document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

/**
 * Vista documento. costruisci(lingua) restituisce la struttura del documento aggiornata;
 * chiudi() torna al foglio. Il salvataggio in sospeso è già stato inviato da chi apre questa vista.
 */
export function vistaDocumento({ costruisci, lingua, onLingua, chiudi, titoloBreve }) {
  let lg = lingua;
  const foglio = h('div', { class: 'doc-wrap' });
  let corrente = null;
  const disegna = () => { corrente = costruisci(lg); foglio.replaceChildren(disegnaDocumento(corrente)); };

  const sel = h('select', { class: 'input', 'aria-label': 'Document language' },
    h('option', { value: 'en', selected: lg === 'en' }, 'English'), h('option', { value: 'it', selected: lg === 'it' }, 'Italiano'));
  sel.addEventListener('change', () => { lg = sel.value; onLingua && onLingua(lg); disegna(); });

  const scarica = h('button', { class: 'btn primary', onclick: async () => {
    scarica.disabled = true;
    try { await creaPdf(corrente, nomeFile(corrente)); } catch (e) { toast('PDF non creato: ' + e.message, 'err'); } finally { scarica.disabled = false; }
  } }, icon('download'), 'Download PDF');

  disegna();
  return h('div', { class: 'doc-view' },
    h('div', { class: 'doc-tools' },
      h('button', { class: 'btn', onclick: chiudi }, icon('back'), 'Close'),
      h('span', { class: 'doc-nome' }, titoloBreve),
      h('label', { class: 'cell' }, h('span', { class: 'cell-l' }, 'Language'), sel),
      h('div', { class: 'row doc-azioni' },
        h('button', { class: 'btn', onclick: async () => toast(await copia(testoDocumento(corrente)) ? 'Testo copiato' : 'Copia non riuscita: seleziona il testo a mano', ''), }, icon('copy'), 'Copy Text'),
        h('button', { class: 'btn', onclick: () => window.print() }, icon('print'), 'Print / Save PDF'),
        scarica)),
    foglio);
}
