import { api } from './api.js';
import { h, icon, toast, riempi } from './ui.js';
import { store, upsertEvent } from './app.js';
import { giornoLungo, orarioGiornata } from './format.js';
import { normalizzaOra } from './orari.js';
import { nomeTag } from './persone.js';
import { chipLivello, altroImpegno } from './livelli.js';

/**
 * Scheda "Giornate" dell'evento: una sezione per giornata con orari modificabili, staff della giornata e nota.
 * - Orario "dal Calendar" o "modificato da te": un orario corretto a mano non viene mai sovrascritto dalla sincronizzazione;
 *   se il Calendar cambia compare la differenza e si sceglie.
 * - Owner e Production correggono orari e nota; solo l'Owner vede e corregge i turni delle persone e i conflitti.
 */
export function giornateCard(ev, redraw) {
  const p = store.user.permessi;
  const puoModificare = !!p.modificare && ev.stato !== 'archiviato';
  const owner = !!p.admin;
  const giorni = ev.giorni || [];

  async function ricarica() {
    const y = window.scrollY;
    const upd = await api('eventi.get', { id: ev.id });
    upsertEvent(upd);
    redraw(upd);
    window.scrollTo(0, y);
  }

  async function chiama(azione, payload) {
    const upd = await api(azione, payload);
    if (upd && upd.id === ev.id) { upsertEvent(upd); const y = window.scrollY; redraw(upd); window.scrollTo(0, y); }
    return upd;
  }

  const sezioni = giorni.map(g => sezione(g));
  const aggiungi = puoModificare ? aggiungiGiornata() : null;

  return h('section', { class: 'card', id: 'giornate' },
    h('header', {}, h('span', { class: 'label' }, giorni.length > 1 ? 'Giornate' : 'Giornata'),
      giorni.length > 1 ? h('span', { class: 'tag' }, giorni.length + ' giornate') : null),
    h('div', {}, sezioni, aggiungi),
    ev.origine === 'calendar'
      ? h('div', { class: 'in', style: { paddingTop: 0 } }, h('p', { class: 'help', style: { margin: 0 } },
        'Le giornate e gli orari arrivano dal Google Calendar. Un orario corretto qui resta tuo: se il Calendar cambia, ti viene segnalato e scegli tu.'))
      : null);

  // ---------- una giornata ----------
  function sezione(g) {
    const stato = h('div', { class: 'status-line' });
    const modificabile = puoModificare && !g.virtuale;
    const dalCalendar = g.origine === 'calendario';
    const manuale = g.origine_orario === 'manuale';

    const inIni = h('input', { class: 'input', value: g.ora_inizio || '', inputmode: 'numeric', placeholder: '--:--', 'aria-label': 'Inizio ' + giornoLungo(g.data), autocomplete: 'off' });
    const inFin = h('input', { class: 'input', value: g.ora_fine || '', inputmode: 'numeric', placeholder: '--:--', 'aria-label': 'Fine ' + giornoLungo(g.data), autocomplete: 'off' });
    const piu = h('span', { class: 'tag warn piu', title: 'La giornata finisce dopo la mezzanotte' }, '+1 giorno');
    piu.hidden = !g.dopo_mezzanotte;
    const taNota = h('textarea', { class: 'input', rows: 2, placeholder: 'Nota della giornata (carico, accessi, referenti…)', 'aria-label': 'Nota della giornata', maxlength: 500 }, g.nota || '');
    const salva = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Salva giornata');

    const sporco = () => (normalizzaOra(inIni.value) !== (g.ora_inizio || '')) || (normalizzaOra(inFin.value) !== (g.ora_fine || '')) || taNota.value !== (g.nota || '');
    function aggiorna() {
      const i = normalizzaOra(inIni.value), f = normalizzaOra(inFin.value);
      const errore = i === null || f === null;
      const uguali = i && f && i === f;
      piu.hidden = !(i && f && f < i);
      salva.disabled = !sporco() || errore || uguali;
      stato.className = 'status-line' + (errore || uguali ? ' err' : '');
      stato.textContent = errore ? 'Orario non valido: scrivi per esempio 21:30 o 2130' : uguali ? 'Inizio e fine coincidono' : sporco() ? 'Modifiche non salvate' : '';
    }
    [inIni, inFin].forEach(i => {
      i.addEventListener('input', aggiorna);
      i.addEventListener('blur', () => { const n = normalizzaOra(i.value); if (n !== null) i.value = n; aggiorna(); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !salva.disabled) salva.click(); });
    });
    taNota.addEventListener('input', aggiorna);
    salva.addEventListener('click', async () => {
      const i = normalizzaOra(inIni.value), f = normalizzaOra(inFin.value);
      if (i === null || f === null) return;
      salva.disabled = true; stato.className = 'status-line'; stato.textContent = 'Salvataggio…';
      const patch = { id: g.id, versione: g.versione, ora_inizio: i, ora_fine: f };
      if (ev.accesso !== false && taNota.value !== (g.nota || '')) patch.nota = taNota.value;
      try { await chiama('giorni.salva', patch); toast('Giornata salvata'); }
      catch (e) { stato.className = 'status-line err'; stato.textContent = e.code === 'CONFLICT' ? 'Qualcun altro ha modificato questa giornata. Ricarica la pagina.' : e.message; salva.disabled = false; }
    });

    const origine = !dalCalendar ? h('span', { class: 'tag', title: 'Giornata aggiunta a mano' }, 'Aggiunta a mano')
      : manuale ? [h('span', { class: 'tag warn' }, 'Modificato da te'),
        h('span', { class: 'help mono' }, 'Calendar: ' + orarioGiornata({ ora_inizio: g.cal_inizio, ora_fine: g.cal_fine })),
        modificabile ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await chiama('giorni.calendario', { id: g.id, versione: g.versione, scelta: 'usa' }); toast('Orario del Calendar ripristinato'); } catch (e) { toast(e.message, 'err'); } } }, 'Ripristina Calendar') : null]
        : h('span', { class: 'tag ok' }, 'Dal Calendar');

    const diff = g.diff ? h('div', { class: 'alert-lv lv-arancio', role: 'alert' },
      h('div', {}, h('b', {}, 'Il Calendar è cambiato. '), 'Ora dice ', h('b', { class: 'mono' }, orarioGiornata({ ora_inizio: g.cal_inizio, ora_fine: g.cal_fine })),
        '; tu hai ', h('b', { class: 'mono' }, orarioGiornata(g)), '.'),
      modificabile ? h('div', { class: 'g-azioni' },
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await chiama('giorni.calendario', { id: g.id, versione: g.versione, scelta: 'tieni' }); } catch (e) { toast(e.message, 'err'); } } }, 'Tieni la mia'),
        h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { try { await chiama('giorni.calendario', { id: g.id, versione: g.versione, scelta: 'usa' }); } catch (e) { toast(e.message, 'err'); } } }, 'Usa quello del Calendar')) : null) : null;

    const fuori = g.stato === 'fuori_calendario' ? h('div', { class: 'alert-lv lv-arancio' }, 'Questa giornata non è più nel Calendar, ma ha una nota, un orario tuo o persone assegnate: non è stata tolta.') : null;

    const orari = modificabile
      ? h('div', { class: 'g-orari' },
        h('label', {}, 'Inizio', inIni), h('label', {}, 'Fine', inFin), piu, h('div', { class: 'origine' }, origine))
      : h('div', { class: 'g-orari' }, h('span', { class: 'g-sola-lettura' }, orarioGiornata(g)), g.virtuale ? null : h('div', { class: 'origine' }, origine));

    const staffRighe = owner ? g.staff.map(s => rigaTurno(g, s)) : null;
    const staffNomi = !owner && g.staff.length ? h('div', { class: 'names', style: { marginTop: 0 } }, g.staff.map(nomeTag)) : null;
    const staffBox = g.staff.length
      ? h('div', { class: 'g-staff', 'aria-label': 'Staff della giornata' }, owner ? staffRighe : staffNomi)
      : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuno assegnato a questa giornata.');

    const notaBox = ev.accesso === false ? null
      : modificabile ? taNota
        : g.nota ? h('div', { class: 'pre' }, g.nota) : null;

    const azioni = modificabile ? h('div', { class: 'g-azioni' }, salva, giorni.length > 1 ? rimuoviBtn(g) : null, stato) : null;

    return h('div', { class: 'giorno' + (g.stato === 'fuori_calendario' ? ' fuori' : ''), 'data-giorno': g.data },
      h('div', { class: 'gh' },
        h('h3', {}, giornoLungo(g.data)),
        h('span', { class: 'tag' }, 'Giorno ' + g.n + ' di ' + g.di),
        h('span', { class: 'grow' }),
        owner && g.staff.some(s => s.livello === 'sovrapposizione') ? h('span', { class: 'lv lv-rosso' }, '⚠ Sovrapposizione') : null),
      fuori, orari, diff, staffBox, notaBox, azioni);
  }

  function rimuoviBtn(g) {
    let fase = 0, conferma = false, tolti = 0;
    const b = h('button', { class: 'btn ghost sm', type: 'button' }, 'Rimuovi giornata');
    const reset = () => { fase = 0; conferma = false; b.disabled = false; b.textContent = 'Rimuovi giornata'; b.classList.remove('danger'); };
    b.addEventListener('click', async () => {
      if (fase === 0) {
        fase = 1; b.textContent = 'Conferma rimozione'; b.classList.add('danger');
        setTimeout(() => { if (fase === 1) reset(); }, 4000);
        return;
      }
      b.disabled = true;
      try {
        const r = await api('giorni.rimuovi', conferma ? { id: g.id, conferma: true } : { id: g.id });
        if (r && r.richiede_conferma) {
          fase = 2; conferma = true; tolti = r.turni; b.disabled = false;
          b.textContent = `Rimuovi comunque (toglie ${tolti} ${tolti === 1 ? 'persona assegnata' : 'persone assegnate'})`;
          return;
        }
        upsertEvent(r); redraw(r); toast('Giornata rimossa');
      } catch (e) { toast(e.code === 'INVALID' ? 'L\'evento deve avere almeno una giornata' : e.message, 'err'); reset(); }
    });
    return b;
  }

  // ---------- turno di una persona in una giornata (solo Owner) ----------
  function rigaTurno(g, s) {
    const proprio = !!(s.propri_inizio || s.propri_fine);
    const ini = s.propri_inizio || g.ora_inizio || '', fin = s.propri_fine || g.ora_fine || '';
    const orario = orarioGiornata({ ora_inizio: ini, ora_fine: fin, dopo_mezzanotte: !!(ini && fin && fin <= ini) });
    const riga = h('div', { class: 'riga', 'data-email': s.email });
    const corpo = () => {
      riempi(riga,
        nomeTag(s),
        h('span', { class: 't' + (proprio ? ' proprio' : ''), title: proprio ? 'Orario del turno diverso dalla giornata' : 'Come la giornata' }, orario),
        chipLivello(s.livello),
        s.nota ? h('span', { class: 'help' }, s.nota) : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Orario di ' + s.nome, onclick: editor }, icon('clock'), 'Orario'),
        s.conflitti && s.conflitti.length ? h('div', { class: 'conf' }, s.conflitti.map(altroImpegno)) : null);
    };
    function editor() {
      const a = h('input', { class: 'input', value: s.propri_inizio || '', placeholder: g.ora_inizio || '--:--', inputmode: 'numeric', 'aria-label': 'Inizio turno' });
      const b = h('input', { class: 'input', value: s.propri_fine || '', placeholder: g.ora_fine || '--:--', inputmode: 'numeric', 'aria-label': 'Fine turno' });
      const n = h('input', { class: 'input nota', value: s.nota || '', placeholder: 'Nota (es. solo montaggio)', 'aria-label': 'Nota del turno', maxlength: 500 });
      const st = h('span', { class: 'status-line' });
      const invia = async (i, f, nota) => {
        try {
          const r = await api('turni.salva', { evento_id: ev.id, giorno_id: g.id, email: s.email, ora_inizio: i, ora_fine: f, nota });
          if (r && r.evento) {
            // il server ha già mandato l'evento aggiornato e la lista dello staff: niente riletture
            const { evento, ...lista } = r;
            const y = window.scrollY;
            upsertEvent(evento); redraw(evento, { staff: lista }); window.scrollTo(0, y);
          } else await ricarica();
        } catch (e) { st.className = 'status-line err'; st.textContent = e.message; }
      };
      riga.append(h('div', { class: 'g-turno-ed' },
        h('label', {}, 'Inizio turno', a), h('label', {}, 'Fine turno', b), h('label', {}, 'Nota', n),
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => {
          const i = normalizzaOra(a.value), f = normalizzaOra(b.value);
          if (i === null || f === null) { st.className = 'status-line err'; st.textContent = 'Orario non valido'; return; }
          invia(i, f, n.value);
        } }, 'Salva'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => invia('', '', n.value) }, 'Come la giornata'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: corpo }, 'Annulla'), st));
      a.focus();
    }
    corpo();
    return riga;
  }

  // ---------- aggiunta di una giornata ----------
  function aggiungiGiornata() {
    const box = h('div', { class: 'g-add' });
    const apri = h('button', { class: 'btn', type: 'button', onclick: mostra }, icon('plus'), 'Aggiungi giornata');
    box.append(apri);
    function mostra() {
      const ultima = giorni.length ? giorni[giorni.length - 1].data : '';
      const sugg = ultima ? addGiorni(ultima, 1) : '';
      const d = h('input', { class: 'input', type: 'date', value: sugg, 'aria-label': 'Data della nuova giornata', style: { width: '170px' } });
      const a = h('input', { class: 'input', placeholder: '--:--', inputmode: 'numeric', style: { width: '104px', textAlign: 'center' }, 'aria-label': 'Inizio' });
      const b = h('input', { class: 'input', placeholder: '--:--', inputmode: 'numeric', style: { width: '104px', textAlign: 'center' }, 'aria-label': 'Fine' });
      const st = h('span', { class: 'status-line' });
      riempi(box,
        h('label', {}, 'Data', d), h('label', {}, 'Inizio', a), h('label', {}, 'Fine', b),
        h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
          const i = normalizzaOra(a.value), f = normalizzaOra(b.value);
          if (!d.value) { st.className = 'status-line err'; st.textContent = 'Scegli la data'; return; }
          if (i === null || f === null) { st.className = 'status-line err'; st.textContent = 'Orario non valido'; return; }
          e.currentTarget.disabled = true;
          try { await chiama('giorni.aggiungi', { evento_id: ev.id, data: d.value, ora_inizio: i, ora_fine: f }); toast('Giornata aggiunta'); }
          catch (err) { st.className = 'status-line err'; st.textContent = err.code === 'CONFLICT' ? 'Esiste già una giornata con questa data' : err.message; e.target.disabled = false; }
        } }, 'Aggiungi'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => box.replaceChildren(apri) }, 'Annulla'), st);
    }
    return box;
  }
}

function addGiorni(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
