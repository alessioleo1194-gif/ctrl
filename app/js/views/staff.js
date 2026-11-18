import { api } from '../api.js';
import { h, toast, loading, riempi } from '../ui.js';
import { upsertEvent, refreshList } from '../app.js';
import { iniziali } from '../persone.js';
import { giornoLungo, orarioGiornata } from '../format.js';
import { chipLivello, altroImpegno, LIVELLI } from '../livelli.js';

const ORIGINE = { calendario: 'da calendario', manuale: 'manuale' };
const RUOLO = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };

/** Riga di testo con il termine trovato evidenziato. */
function evidenzia(testo, termine) {
  const i = termine ? testo.toLowerCase().indexOf(termine.toLowerCase()) : -1;
  if (i < 0) return [testo];
  return [testo.slice(0, i), h('mark', {}, testo.slice(i, i + termine.length)), testo.slice(i + termine.length)];
}

const RANGO = { sovrapposizione: 3, da_verificare: 2, stesso_giorno: 1 };
const peggiore = (lista) => lista.reduce((m, l) => (l && (!m || RANGO[l] > RANGO[m]) ? l : m), null);

/**
 * Scheda "Staff" dell'evento (solo Owner): assegnati, proposte trovate nella descrizione del Calendar,
 * aggiunta manuale. Nessuna proposta vale finché non viene confermata.
 * Prima di assegnare si controlla la disponibilità giornata per giornata: l'avviso non blocca mai
 * ("Assegna comunque"), e si può assegnare solo ai giorni liberi.
 */
export function staffCard(ev, onChange) {
  const card = h('section', { class: 'card', id: 'staff' }, h('header', {}, h('span', { class: 'label' }, 'Staff')), h('div', { class: 'in' }, loading('Staff…')));
  let busy = false;
  let pannello = null;       // { email, tipo: 'aggiungi' | 'conferma' | 'giorni' }

  async function carica() {
    try { disegna(await api('staff.evento', { evento_id: ev.id })); }
    catch (e) { card.replaceChildren(h('header', {}, h('span', { class: 'label' }, 'Staff')), h('div', { class: 'in' }, h('div', { class: 'banner' }, e.message))); }
  }

  /** Dopo una modifica si rilegge l'evento: giornate, nomi e conflitti si aggiornano ovunque. */
  async function aggiornaTutto() {
    try {
      const upd = await api('eventi.get', { id: ev.id });
      upsertEvent(upd); refreshList();
      if (onChange) onChange(upd);
    } catch { /* la lista si aggiorna alla prossima apertura */ }
  }

  async function agisci(azione, email, giorni) {
    if (busy) return;
    busy = true;
    try {
      const payload = { evento_id: ev.id, azione, email };
      if (giorni) payload.giorni = giorni;
      await api('staff.gestisci', payload);
      pannello = null;
      await aggiornaTutto();
      if (!onChange) await carica();
    } catch (e) { toast(e.message, 'err'); }
    busy = false;
  }

  const persona = (a, azioni) => h('span', { class: 'persona pc-' + a.colore },
    h('span', { class: 'av' }, iniziali(a.nome)), a.nome, h('small', {}, [RUOLO[a.ruolo] || a.ruolo, ORIGINE[a.origine]].filter(Boolean).join(' · ')), azioni);

  /** Pannello di controllo disponibilità: giornate scelte, esito per giornata, assegnazione. */
  function pannelloAssegna(s, email, nome, tipo, preselezione) {
    const box = h('div', { class: 'assegna', 'data-email': email }, loading('Controllo disponibilità…'));
    api('staff.verifica', { evento_id: ev.id, email }).then(v => {
      const scelte = new Set(preselezione || v.giorni.map(g => g.giorno_id));
      const checks = {};
      const lista = h('div', { class: 'as-gg' });
      const esito = h('div', { class: 'help' });
      const azioni = h('div', { class: 'as-azioni' });

      v.giorni.forEach(g => {
        const cb = h('input', { type: 'checkbox', checked: scelte.has(g.giorno_id), 'aria-label': 'Giornata ' + g.n, onchange: () => { if (cb.checked) scelte.add(g.giorno_id); else scelte.delete(g.giorno_id); aggiorna(); } });
        checks[g.giorno_id] = cb;
        lista.append(h('label', { class: 'as-g', 'data-giorno': g.data },
          cb,
          h('span', { class: 'c' },
            h('span', { class: 'r' }, h('b', {}, giornoLungo(g.data)), v.giorni.length > 1 ? h('span', { class: 'tag' }, 'Giorno ' + g.n + ' di ' + v.giorni.length) : null,
              h('span', { class: 'mono' }, orarioGiornata({ ora_inizio: g.ora_inizio, ora_fine: g.ora_fine, dopo_mezzanotte: !!(g.ora_inizio && g.ora_fine && g.ora_fine <= g.ora_inizio) })),
              chipLivello(g.livello, true)),
            g.altri.map(altroImpegno))));
      });

      function aggiorna() {
        const scelti = v.giorni.filter(g => scelte.has(g.giorno_id));
        const peg = peggiore(scelti.map(g => g.livello));
        const conflitti = scelti.filter(g => g.livello === 'sovrapposizione' || g.livello === 'da_verificare');
        const liberi = v.giorni.filter(g => v.liberi.includes(g.giorno_id));
        esito.className = 'help';
        esito.textContent = !scelti.length ? 'Scegli almeno una giornata.'
          : peg === 'sovrapposizione' ? `${nome} ha già un impegno che si sovrappone in ${conflitti.filter(g => g.livello === 'sovrapposizione').length === 1 ? 'una giornata' : 'più giornate'}. Puoi assegnarlo comunque.`
            : peg === 'da_verificare' ? `${nome} ha un altro impegno nella stessa data ma manca un orario: da verificare. Puoi assegnarlo comunque.`
              : peg === 'stesso_giorno' ? `${nome} ha un altro evento nello stesso giorno, ma con orari compatibili.`
                : `${nome} è libero nelle giornate scelte.`;
        const conf = peg === 'sovrapposizione' || peg === 'da_verificare';
        riempi(azioni,
          h('button', { class: 'btn primary', type: 'button', disabled: !scelti.length, onclick: () => agisci(tipo, email, tuttiScelti(scelti)) },
            tipo === 'giorni' ? 'Salva giornate' : conf ? 'Assegna comunque' : 'Assegna'),
          conf && liberi.length && liberi.length < v.giorni.length
            ? h('button', { class: 'btn', type: 'button', onclick: () => agisci(tipo, email, liberi.map(g => g.giorno_id)) }, 'Assegna solo i giorni liberi') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { pannello = null; carica(); } }, 'Annulla'));
      }
      const tuttiScelti = (scelti) => scelti.length === v.giorni.length ? undefined : scelti.map(g => g.giorno_id);

      riempi(box,
        h('h4', {}, tipo === 'giorni' ? 'Giornate di ' + nome : 'Assegna ' + nome),
        v.giorni.length > 1 ? h('p', { class: 'help', style: { margin: 0 } }, 'Scegli le giornate in cui lavora. Le giornate aggiunte in seguito vanno a chi lavora su tutte.') : null,
        lista, esito, azioni);
      aggiorna();
    }).catch(e => box.replaceChildren(h('div', { class: 'banner' }, e.message)));
    return box;
  }

  function disegna(s) {
    const piu = s.giorni.length > 1;
    const proposte = s.proposte.map(p => h('div', { class: 'staff-prop', 'data-email': p.email },
      h('span', { class: 'av pc-' + p.colore }, iniziali(p.nome)),
      h('div', { class: 't' }, h('b', {}, p.nome), ' · ' + (RUOLO[p.ruolo] || p.ruolo),
        h('small', {}, 'Trovato nella descrizione: «', evidenzia(p.trovato, p.termine), '»'),
        p.livello ? h('small', {}, chipLivello(p.livello), ' ', LIVELLI[p.livello].lungo) : null),
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        if (piu || p.livello === 'sovrapposizione' || p.livello === 'da_verificare') { pannello = { email: p.email, tipo: 'conferma' }; disegna(s); }
        else agisci('conferma', p.email);
      } }, 'Conferma'),
      h('button', { class: 'btn', type: 'button', onclick: () => agisci('scarta', p.email) }, 'Non è lui')));

    const sel = h('select', { class: 'input', 'aria-label': 'Aggiungi staff', onchange: (e) => {
      const v = e.target.value; e.target.value = '';
      if (!v) return;
      const c = s.candidati.find(x => x.email === v);
      if (piu || (c && (c.livello === 'sovrapposizione' || c.livello === 'da_verificare'))) { pannello = { email: v, tipo: 'aggiungi' }; disegna(s); }
      else agisci('aggiungi', v);
    } },
      h('option', { value: '' }, 'Aggiungi manualmente…'),
      s.candidati.map(c => h('option', { value: c.email }, c.nome + ' · ' + (RUOLO[c.ruolo] || c.ruolo) + (c.livello ? ' · ' + LIVELLI[c.livello].testo.toLowerCase() : ''))));

    const giorniDi = (a) => a.giorni_tutti ? (piu ? 'tutte le giornate' : '') : `${a.turni.length} di ${s.giorni.length} giornate`;
    const assegnati = s.assegnati.map(a => h('div', { class: 'staff-pers', 'data-email': a.email },
      persona(a, h('button', { type: 'button', 'aria-label': 'Togli ' + a.nome + ' dallo staff', title: 'Togli dallo staff', onclick: () => agisci('rimuovi', a.email) }, '×')),
      h('div', { class: 'sub' }, giorniDi(a) ? 'Lavora: ' + giorniDi(a) : null, chipLivello(a.livello),
        piu ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { pannello = { email: a.email, tipo: 'giorni' }; disegna(s); } }, 'Modifica giornate') : null)));

    let pann = null;
    if (pannello) {
      const pe = [...s.assegnati, ...s.proposte, ...s.candidati].find(x => x.email === pannello.email);
      const pre = pannello.tipo === 'giorni' ? s.assegnati.find(a => a.email === pannello.email)?.turni.map(t => t.giorno_id) : undefined;
      pann = pannelloAssegna(s, pannello.email, pe ? pe.nome : pannello.email, pannello.tipo, pre);
    }

    card.replaceChildren(
      h('header', {}, h('span', { class: 'label' }, 'Staff'),
        h('span', { class: 'tag' }, s.assegnati.length === 1 ? '1 assegnato' : s.assegnati.length + ' assegnati'),
        h('span', { class: 'help', style: { marginLeft: 'auto' } }, 'Solo l\'Owner assegna')),
      h('div', { class: 'in', style: { display: 'grid', gap: '12px' } },
        s.assegnati.length
          ? h('div', { class: 'staff-list', style: { display: 'grid', gap: '10px' } }, assegnati)
          : h('p', { class: 'help', style: { margin: 0 } }, 'Nessuno assegnato: chi non è nello staff vede l\'evento ma non documenti, file e note.'),
        proposte,
        pann,
        s.scartate.length ? h('div', { class: 'staff-scartate' }, 'Scartati:', s.scartate.map(a => h('span', {}, a.nome + ' ',
          h('button', { class: 'btn sm', type: 'button', onclick: () => agisci('ripristina', a.email) }, 'Ripristina')))) : null,
        h('div', { class: 'staff-add' }, sel, h('span', { class: 'help' }, 'Le assegnazioni confermate o manuali non cambiano quando il calendario cambia.'))));
  }

  carica();
  return card;
}
