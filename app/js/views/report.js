import { api } from '../api.js';
import { h, icon, toast, loading } from '../ui.js';
import { store } from '../app.js';
import { dataIt, today } from '../format.js';
import { costruisciReport, nomeFileReport } from '../report-xlsx.js';
import { oreHM } from '../stats-popup.js';

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const durataTesto = (r) => r.durata_min === null || r.durata_min === undefined ? '—' : oreHM(r.durata_min / 60);

/**
 * Staff Work Report (solo Owner): una riga per tecnico e per giornata, letta dai turni.
 * Orari pianificati. Gli eventi annullati restano in elenco, segnalati, ma non entrano nei totali.
 * Non c'è distinzione tra eventi e giornate: si contano solo le giornate.
 */
export async function renderReport(main) {
  const oggi = today();
  const f = { anno: oggi.slice(0, 4), mese: oggi.slice(5, 7), email: '', evento_id: '', da: '', a: '', annullati: true };
  const wrap = h('div', { class: 'settings report' });
  main.replaceChildren(wrap);
  let dati = null;
  let seq = 0;
  let filtri = null;      // tendine: ricordate dalla prima lettura (senza filtri) così non spariscono scegliendo un valore

  async function leggi(payload) { return api('report.righe', payload); }

  async function carica() {
    const mio = ++seq;
    const corpo = wrap.querySelector('.rp-corpo');
    if (corpo) corpo.replaceChildren(loading('Caricamento report…'));
    try {
      const p = { anno: f.anno, mese: f.mese, annullati: f.annullati };
      if (f.email) p.email = f.email;
      if (f.evento_id) p.evento_id = f.evento_id;
      if (f.da) p.da = f.da;
      if (f.a) p.a = f.a;
      const r = await leggi(p);
      if (mio !== seq) return;
      dati = r;
      if (!filtri) filtri = r.filtri;
      disegna();
    } catch (e) {
      if (mio !== seq) return;
      wrap.replaceChildren(intestazione(), h('div', { class: 'banner' }, e.message));
    }
  }

  function intestazione() {
    return h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('h1', {}, 'Staff Work Report'),
      h('a', { class: 'btn', href: '#/' }, icon('back'), 'Eventi'));
  }

  function campo(etichetta, el) { return h('label', { class: 'rp-f' }, h('span', {}, etichetta), el); }

  function barraFiltri() {
    const anni = [...new Set([...(filtri?.anni || []), oggi.slice(0, 4), f.anno].filter(Boolean))].sort();
    const sel = (nome, valore, opzioni, on) => {
      const s = h('select', { class: 'input', 'aria-label': nome, onchange: (e) => on(e.target.value) },
        opzioni.map(([v, t]) => h('option', { value: v, selected: v === valore }, t)));
      return s;
    };
    const cambia = (k) => (v) => { f[k] = v; if (k === 'anno' && !v) f.mese = ''; carica(); };
    return h('div', { class: 'rp-filtri card' }, h('div', { class: 'in rp-griglia' },
      campo('Anno', sel('Anno', f.anno, [['', 'Tutti'], ...anni.map(a => [a, a])], cambia('anno'))),
      campo('Mese', sel('Mese', f.mese, [['', 'Tutti'], ...MESI.map((m, i) => [String(i + 1).padStart(2, '0'), m])], (v) => { f.mese = v; if (v && !f.anno) f.anno = oggi.slice(0, 4); carica(); })),
      campo('Tecnico', sel('Tecnico', f.email, [['', 'Tutti'], ...(filtri?.tecnici || []).map(t => [t.email, t.nome])], cambia('email'))),
      campo('Evento', sel('Evento', f.evento_id, [['', 'Tutti'], ...(filtri?.eventi || []).map(t => [t.id, t.titolo])], cambia('evento_id'))),
      campo('Dal', h('input', { class: 'input', type: 'date', value: f.da, 'aria-label': 'Dal', onchange: (e) => { f.da = e.target.value; carica(); } })),
      campo('Al', h('input', { class: 'input', type: 'date', value: f.a, 'aria-label': 'Al', onchange: (e) => { f.a = e.target.value; carica(); } })),
      h('label', { class: 'switch rp-annullati' }, h('input', { type: 'checkbox', checked: f.annullati, onchange: (e) => { f.annullati = e.target.checked; carica(); } }), 'Mostra eventi annullati'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(f, { anno: oggi.slice(0, 4), mese: oggi.slice(5, 7), email: '', evento_id: '', da: '', a: '', annullati: true }); carica(); } }, 'Mese corrente')));
  }

  function titoloPeriodo() {
    const p = dati.periodo;
    if (p.da || p.a) return `${p.da ? dataIt(p.da) : '…'} – ${p.a ? dataIt(p.a) : '…'}`;
    if (p.anno && p.mese) return `${MESI[Number(p.mese) - 1]} ${p.anno}`;
    return p.anno || 'Tutto lo storico';
  }

  async function esporta(btn) {
    btn.disabled = true;
    try {
      // il file riguarda il periodo scelto (anno/mese) per tutti i tecnici e tutti gli eventi
      const p = { anno: f.anno, mese: f.mese, annullati: true };
      if (f.da) p.da = f.da;
      if (f.a) p.a = f.a;
      const r = await leggi(p);
      const bytes = costruisciReport(r.righe);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: nomeFileReport(r.periodo) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Report scaricato: ' + nomeFileReport(r.periodo));
    } catch (e) { toast(e.message || 'Esportazione non riuscita', 'err'); }
    btn.disabled = false;
  }

  function riga(r) {
    const cella = (label, ...c) => h('td', { 'data-label': label, class: c.length === 1 && c[0] === '—' ? 'vuota' : '' }, h('span', { class: 'v' }, ...c));
    return h('tr', { class: r.annullato ? 'annullato' : '', 'data-evento': r.evento_id, 'data-email': r.email },
      cella('Data', h('span', { class: 'mono' }, dataIt(r.data))),
      cella('Giorno', r.giorno),
      cella('Tecnico', h('button', { class: 'link', type: 'button', title: 'Mostra solo ' + r.tecnico, onclick: () => { f.email = r.email; carica(); } }, r.tecnico)),
      cella('Evento', h('a', { href: '#/e/' + r.evento_id }, r.evento), r.di > 1 ? h('span', { class: 'tag' }, 'Giorno ' + r.n + ' di ' + r.di) : null, r.annullato ? h('span', { class: 'tag danger' }, 'Annullato') : null),
      cella('Location', r.location || '—'),
      cella('Inizio', h('span', { class: 'mono' }, r.ora_inizio || '—')),
      cella('Fine', h('span', { class: 'mono' }, r.ora_fine || '—'), r.dopo_mezzanotte ? h('span', { class: 'tag' }, '+1 giorno') : null),
      cella('Durata', h('span', { class: 'mono' }, durataTesto(r))),
      cella('Nota', r.nota || '—'));
  }

  function disegna() {
    const t = dati.totali;
    const btn = h('button', { class: 'btn primary', type: 'button', onclick: (e) => esporta(e.currentTarget) }, icon('download'), 'Esporta report mensile (.xlsx)');
    const perTec = dati.per_tecnico.map(x => h('button', { class: 'rp-tec' + (f.email === x.email ? ' on' : ''), type: 'button', 'data-email': x.email, onclick: () => { f.email = f.email === x.email ? '' : x.email; carica(); } },
      h('b', {}, x.nome), h('span', { class: 'mono' }, `${x.giornate} ${x.giornate === 1 ? 'giornata' : 'giornate'} · ${oreHM(x.ore)}`)));
    const corpo = h('div', { class: 'rp-corpo' },
      h('div', { class: 'rp-tot card' }, h('div', { class: 'in' },
        h('div', { class: 'label' }, titoloPeriodo()),
        h('div', { class: 'rp-num' },
          h('div', {}, h('b', { 'data-k': 'giornate' }, String(t.giornate)), h('span', {}, t.giornate === 1 ? 'giornata' : 'giornate')),
          h('div', {}, h('b', { 'data-k': 'ore' }, oreHM(t.ore)), h('span', {}, 'ore pianificate'))),
        t.senza_orario ? h('p', { class: 'help', style: { margin: '6px 0 0' } }, `${t.senza_orario} ${t.senza_orario === 1 ? 'giornata senza orario non è' : 'giornate senza orario non sono'} nel conteggio delle ore.`) : null,
        t.annullate ? h('p', { class: 'help', style: { margin: '6px 0 0' } }, `${t.annullate} ${t.annullate === 1 ? 'giornata di evento annullato esclusa' : 'giornate di eventi annullati escluse'} dai totali.`) : null),
        perTec.length ? h('div', { class: 'in rp-tecs' }, perTec) : null),
      dati.righe.length
        ? h('div', { class: 'rp-tabella card' }, h('table', { class: 'rp' },
          h('thead', {}, h('tr', {}, ['Data', 'Giorno', 'Tecnico', 'Evento', 'Location', 'Inizio', 'Fine', 'Durata', 'Nota'].map(c => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, dati.righe.map(riga))))
        : h('div', { class: 'empty' }, h('span', { class: 'label' }, 'Nessuna giornata'), h('p', {}, 'Nel periodo scelto nessun tecnico ha giornate assegnate.')));
    wrap.replaceChildren(
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('h1', {}, 'Staff Work Report'),
        h('div', { class: 'row' }, btn, h('a', { class: 'btn', href: '#/' }, icon('back'), 'Eventi'))),
      barraFiltri(), corpo);
  }

  wrap.append(intestazione(), loading('Caricamento report…'));
  void store;
  carica();
}
