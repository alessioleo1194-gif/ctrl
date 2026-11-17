import { h, icon } from '../ui.js';
import { creaGriglia } from '../grid.js';
import { nuovoId } from '../ids.js';
import { costruisciMateriali } from '../documento-dati.js';
import { apriFoglio } from './foglio.js';


export function renderMateriali(main, produzioneId) { return apriFoglio(main, produzioneId, 'materiali', { crea }); }

const nuovaVoce = () => ({ id: nuovoId('m'), voce: '', qta: '', note: '' });
const voceVuota = (x) => !x.voce && !x.qta && !x.note;
const copiaVoce = (x) => ({ ...x, id: nuovoId('m') });

function crea(r, modifica) {
  const prod = r.produzione, eventi = r.eventi;
  const dati = r.dati || { sezioni: [] };
  const libreria = r.suggerimenti || [];     // materiali già usati in altre produzioni: un aiuto, non un obbligo
  let lingua = 'en';
  let notifica = () => {};
  let griglie = [];                          // { sezione, griglia }
  let contenitore = null;

  const sezioneVuota = () => ({ id: nuovoId('s'), nome: '', righe: [] });
  if (!dati.sezioni.length) dati.sezioni.push(sezioneVuota());

  const unici = (valori) => { const v = new Set(); return valori.filter(x => { const k = x.toLowerCase(); if (!x || v.has(k)) return false; v.add(k); return true; }); };
  const tutte = () => dati.sezioni.flatMap(s => s.righe);

  function griglia(s) {
    const g = creaGriglia({
      etichetta: s.nome || 'Location', righe: s.righe, nuovaRiga: nuovaVoce, autoCresci: true, minimoRighe: 5, solaLettura: !modifica,
      vuota: voceVuota, maxRighe: 500,
      colonne: [
        { chiave: 'voce', titolo: 'Item', classe: 'c-voce', opzioni: (riga) => {
          const qui = unici(tutte().filter(x => x !== riga).map(x => x.voce)).map(v => ({ valore: v }));
          const nomi = new Set(qui.map(x => x.valore.toLowerCase()));
          return qui.concat(libreria.filter(l => !nomi.has(l.voce.toLowerCase())).map(l => ({ valore: l.voce, dettaglio: l.note || '', extra: l })));
        } },
        { chiave: 'qta', titolo: 'Quantity', classe: 'c-qta', modo: 'decimal' },
        { chiave: 'note', titolo: 'Notes', classe: 'c-note' }
      ],
      onScelta: (riga, chiave, o) => {
        if (chiave !== 'voce') return;
        const ex = o.extra || tutte().find(x => x !== riga && x.voce.toLowerCase() === o.valore.toLowerCase());
        if (ex) { if (!riga.note) riga.note = ex.note || ''; }
        if (!riga.qta) riga.qta = '1';
      },
      onModifica: () => notifica()
    });
    return g;
  }

  function bandaSezione(s, g) {
    const nome = h('input', { class: 'sez-nome', type: 'text', value: s.nome, placeholder: 'Location name (e.g. MAIN STAGE)', 'aria-label': 'Location name', readonly: !modifica, autocomplete: 'off' });
    nome.addEventListener('input', () => { s.nome = nome.value; notifica(); });
    let armato = false;
    const elimina = h('button', { class: 'btn ghost sez-x', 'aria-label': 'Delete location ' + (s.nome || ''), onclick: (e) => {
      if (!armato) {
        armato = true; e.currentTarget.textContent = 'Confirm delete'; e.currentTarget.setAttribute('aria-label', 'Confirm delete location');
        setTimeout(() => { armato = false; elimina.replaceChildren(icon('x')); elimina.setAttribute('aria-label', 'Delete location ' + (s.nome || '')); }, 3500); return;
      }
      dati.sezioni.splice(dati.sezioni.indexOf(s), 1);
      if (!dati.sezioni.length) dati.sezioni.push(sezioneVuota());
      disegna(); notifica();
    } }, icon('x'));
    const duplica = h('button', { class: 'btn ghost', title: 'Duplicate this location with all its rows', onclick: () => {
      const copia = { id: nuovoId('s'), nome: s.nome ? s.nome + ' (copy)' : '', righe: s.righe.filter(x => !voceVuota(x)).map(copiaVoce) };
      dati.sezioni.splice(dati.sezioni.indexOf(s) + 1, 0, copia);
      disegna(); notifica();
      const i = contenitore.querySelector(`[data-sez="${copia.id}"] .sez-nome`);
      if (i) { i.focus(); i.select(); }
    } }, icon('copy'), 'Duplicate');
    return h('div', { class: 'sez-banda' }, nome, modifica ? [duplica, elimina] : null);
  }

  function disegna() {
    griglie.forEach(x => x.griglia.distruggi());
    griglie = dati.sezioni.map(s => ({ sezione: s, griglia: griglia(s) }));
    const nuova = h('input', { class: 'sez-nome nuova', type: 'text', placeholder: '+ New location: write its name and press Enter', 'aria-label': 'New location name', autocomplete: 'off' });
    const crea = () => {
      const nome = nuova.value.trim();
      if (!nome) return;
      nuova.value = '';                       // il cambio di fuoco manda un "change": senza questo creerebbe la location due volte
      const s = { ...sezioneVuota(), nome };
      dati.sezioni.push(s);
      disegna(); notifica();
      const g = griglie.find(x => x.sezione === s);
      if (g) g.griglia.focus(0, 0);
    };
    nuova.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); crea(); } });
    nuova.addEventListener('change', crea);
    contenitore.replaceChildren(...griglie.map(({ sezione, griglia: g }) =>
      h('section', { class: 'card sez', 'data-sez': sezione.id }, bandaSezione(sezione, g), h('div', { class: 'in sfoglio' }, g.el))),
      modifica ? h('section', { class: 'card sez nuova-sez' }, h('div', { class: 'sez-banda' }, nuova)) : null);
  }

  const pulito = () => ({
    sezioni: dati.sezioni.map(s => ({ ...s, righe: s.righe.filter(x => !voceVuota(x)) })).filter(s => s.nome.trim() || s.righe.length)
  });

  return {
    dati: pulito,
    corpo: () => { contenitore = h('div', { class: 'foglio materiali' }); disegna(); return contenitore; },
    aggancia: (f) => { notifica = f; },
    strumenti: () => [],
    lingua: () => lingua,
    impostaLingua: (lg) => { lingua = lg; },
    costruisci: (lg) => costruisciMateriali(prod, eventi, pulito(), { lingua: lg }),
    ricarica: (unito) => {
      dati.sezioni.splice(0, dati.sezioni.length, ...unito.sezioni);
      if (!dati.sezioni.length) dati.sezioni.push(sezioneVuota());
      if (contenitore) disegna();
    },
    distruggi: () => griglie.forEach(x => x.griglia.distruggi())
  };
}
