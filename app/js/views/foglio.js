import { api } from '../api.js';
import { h, icon, loading } from '../ui.js';
import { creaSalvataggio } from '../salvataggio.js';
import { pdfBase64 } from '../pdf.js';
import { nomeFile } from '../documento-dati.js';
import { store } from '../app.js';
import { vistaDocumento } from './doc.js';

/**
 * Guscio comune dei due fogli (Production Plan e Material List): carica il documento,
 * mostra barra di stato e pulsanti, salva da solo, passa dal foglio al documento finale.
 * Il foglio vero e proprio lo disegna `tipoFoglio` (plan.js, materiali.js).
 */
export async function apriFoglio(main, produzioneId, tipo, tipoFoglio) {
  main.className = 'foglio-pagina';
  main.replaceChildren(loading('Apertura del foglio…'));
  let r;
  try { r = await api('documento.get', { produzione_id: produzioneId, tipo }); }
  catch (e) {
    main.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'banner' }, e.code === 'NOT_FOUND' ? 'Scheda non trovata.' : e.message),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'Torna agli eventi'))));
    return;
  }
  const modifica = r.permessi.modificare;
  const evento = r.eventi[0];
  const foglio = tipoFoglio.crea(r, modifica);   // { dati(), corpo(), costruisci(lingua), lingua(), ricarica(dati) }

  let pdfSporco = false;
  const stato = h('span', { class: 'save-ind', 'data-stato': 'ok', role: 'status' }, modifica ? 'Tutto salvato' : 'Sola lettura');
  const saver = modifica ? creaSalvataggio({
    produzioneId, tipo, versione: r.versione, dati: foglio.dati(), prendiDati: () => foglio.dati(),
    onStato: (s) => { stato.textContent = s.testo + (pdfSporco && s.tipo === 'ok' ? ' · PDF da aggiornare (Save Changes)' : ''); stato.dataset.stato = s.tipo; },
    onRemoto: (unito) => { foglio.ricarica(unito); }
  }) : null;
  foglio.aggancia(() => { pdfSporco = true; saver && saver.modificato(); });

  const finestra = (e) => { if (saver && saver.inSospeso()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', finestra);
  const pulisci = () => { window.removeEventListener('beforeunload', finestra); foglio.distruggi && foglio.distruggi(); };
  window.addEventListener('hashchange', pulisci, { once: true });

  const nome = tipo === 'plan' ? 'Production Plan' : 'Material List';
  const nav = h('nav', { class: 'foglio-nav', 'aria-label': 'Documenti della produzione' },
    h('a', { class: 'btn ghost', href: '#/e/' + evento.id, style: { marginLeft: '-8px' } }, icon('back'), 'Event'),
    h('a', { class: 'tab', href: '#/p/' + produzioneId + '/plan', 'aria-current': tipo === 'plan' ? 'page' : null }, icon('piano'), 'Production Plan'),
    h('a', { class: 'tab mat', href: '#/p/' + produzioneId + '/materiali', 'aria-current': tipo === 'materiali' ? 'page' : null }, icon('materiale'), 'Material List'));

  /** Genera il PDF del documento salvato e lo archivia come file dell'evento (accende l'icona nell'elenco). */
  async function archiviaPdf() {
    stato.dataset.stato = 'salvataggio'; stato.textContent = 'Creo il PDF…';
    try {
      const d = foglio.costruisci(foglio.lingua());
      const dati = await pdfBase64(d);
      await api('documento.pdf', { produzione_id: produzioneId, tipo, nome: nomeFile({ ...d, titolo: nome }), dati });
      pdfSporco = false;
      stato.dataset.stato = 'ok'; stato.textContent = 'Salvato · PDF aggiornato nell\'evento';
      (store.events || []).filter(x => x.produzione_id === produzioneId).forEach(x => { if (x.stato_doc) x.stato_doc[tipo === 'plan' ? 'piano' : 'materiale'] = true; x.produzione = undefined; });
    } catch (e) {
      stato.dataset.stato = 'errore'; stato.textContent = 'Documento salvato, PDF non aggiornato: ' + e.message;
    }
  }

  const salvaOra = h('button', { class: 'btn', disabled: !modifica, onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      await saver.subito();
      if (!saver.fermo()) await archiviaPdf();
    } finally { b.disabled = !modifica; }
  } }, 'Save Changes');

  const mostraFoglio = () => main.replaceChildren(nav, barra(), foglio.corpo());
  const mostraDoc = async () => {
    if (saver) await saver.subito();
    if (saver && saver.fermo()) return;   // errore: resta sul foglio, l'indicatore lo spiega
    main.replaceChildren(vistaDocumento({
      costruisci: (lg) => foglio.costruisci(lg), lingua: foglio.lingua(), onLingua: (lg) => foglio.impostaLingua(lg),
      chiudi: mostraFoglio, titoloBreve: r.produzione.nome + ' · ' + nome
    }));
    window.scrollTo(0, 0);
  };
  function barra() {
    return h('div', { class: 'foglio-barra' },
      h('div', { class: 'foglio-titolo' }, h('h1', {}, nome), foglio.lingueSelect ? foglio.lingueSelect() : null),
      h('div', { class: 'row foglio-azioni' }, stato, ...foglio.strumenti(),
        h('button', { class: 'btn primary', onclick: mostraDoc }, tipo === 'plan' ? 'Generate PdP' : 'Generate list'),
        salvaOra));
  }
  mostraFoglio();
  foglio.dopoMostra && foglio.dopoMostra();
}
