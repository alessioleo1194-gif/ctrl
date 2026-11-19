import { api } from '../api.js';
import { h, sheet, toast } from '../ui.js';
import { navigate, upsertEvent } from '../app.js';
import { today } from '../format.js';

/** Palette colori di Google Calendar + neutro. */
export const PALETTE = ['#5b6472', '#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#039be5', '#616161', '#3f51b5', '#0b8043', '#d50000'];

/** Crea (ev = null) o modifica un evento: i manuali per intero, quelli del Calendar solo titolo, date, luogo e descrizione. */
export function openEventForm(ev, onSaved) {
  const daCal = !!(ev && ev.origine === 'calendar');
  const v = ev || { titolo: '', data: today(), data_fine: '', ora_inizio: '', ora_fine: '', luogo: '', descrizione: '', colore: PALETTE[0] };
  let colore = v.colore || PALETTE[0];
  const f = (name, attrs = {}) => h('input', { class: 'input', name, value: v[name] || '', ...attrs });
  const err = h('div', { class: 'err', role: 'alert' });

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colore' },
    PALETTE.map(c => h('button', { type: 'button', style: { background: c }, 'aria-label': 'Colore ' + c, 'aria-pressed': String(c === colore), onclick: (e) => {
      colore = c; swatches.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } })));

  const save = h('button', { class: 'btn primary', type: 'submit' }, ev ? 'Salva' : 'Crea evento');
  const form = h('form', { novalidate: true },
    h('h2', {}, ev ? 'Modifica evento' : 'Nuovo evento'),
    h('label', { class: 'field' }, h('span', {}, 'Titolo *'), f('titolo', { required: true, maxlength: 200, autocomplete: 'off' })),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', {}, 'Data *'), f('data', { type: 'date', required: true })),
      h('label', { class: 'field' }, h('span', {}, 'Fino al (se più giorni)'), f('data_fine', { type: 'date' }))),
    daCal ? null : h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', {}, 'Ora inizio'), f('ora_inizio', { type: 'time' })),
      h('label', { class: 'field' }, h('span', {}, 'Ora fine'), f('ora_fine', { type: 'time' }))),
    h('label', { class: 'field' }, h('span', {}, 'Luogo'), f('luogo', { maxlength: 200 })),
    h('label', { class: 'field' }, h('span', {}, 'Descrizione'), h('textarea', { class: 'input', name: 'descrizione', maxlength: 5000 }, v.descrizione || '')),
    daCal ? null : h('div', { class: 'field' }, h('span', {}, 'Colore'), swatches),
    daCal ? h('p', { class: 'help' }, 'Evento del Google Calendar: le correzioni restano tue anche dopo l\'aggiornamento dal Calendar, che non viene modificato. Se il Calendar cambia lo stesso dato ti viene segnalato. Gli orari si correggono nella giornata, nella scheda dell\'evento.') : null,
    err,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Annulla'), save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries((daCal ? ['titolo', 'data', 'data_fine', 'luogo', 'descrizione'] : ['titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo', 'descrizione']).map(k => [k, String(fd.get(k) || '').trim()]));
    if (!daCal) payload.colore = colore;
    if (!payload.titolo) return (err.textContent = 'Il titolo è obbligatorio.');
    if (!payload.data) return (err.textContent = 'La data è obbligatoria.');
    if (payload.data_fine && payload.data_fine < payload.data) return (err.textContent = 'La data di fine precede quella di inizio.');
    if (!payload.data_fine) payload.data_fine = payload.data;
    save.disabled = true; save.textContent = 'Salvataggio…'; err.textContent = '';
    try {
      const out = ev
        ? await api('eventi.update', { id: ev.id, versione: ev.versione, ...payload })
        : await api('eventi.create', payload);
      upsertEvent(out);
      dlg.close();
      toast(ev ? (daCal ? 'Correzione salvata' : 'Evento aggiornato') : 'Evento creato');
      if (onSaved) onSaved(out); else navigate('#/e/' + out.id);
    } catch (x) {
      err.textContent = x.code === 'CONFLICT' ? 'Qualcun altro ha modificato l\'evento: chiudi e riapri per vedere la versione aggiornata.' : x.message;
      save.disabled = false; save.textContent = ev ? 'Salva' : 'Crea evento';
    }
  });

  const dlg = sheet(form);
  form.querySelector('[name=titolo]').focus();
}
