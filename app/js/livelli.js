/** Livelli di disponibilità di una persona in una giornata (stessi nomi del backend). */
import { h } from './ui.js';
import { orarioGiornata } from './format.js';

export const LIVELLI = {
  sovrapposizione: { cls: 'lv-rosso', testo: 'Sovrapposizione', lungo: 'Orari che si sovrappongono con un altro evento' },
  da_verificare: { cls: 'lv-arancio', testo: 'Orario da verificare', lungo: 'Stessa data di un altro evento, ma manca un orario' },
  stesso_giorno: { cls: 'lv-azzurro', testo: 'Stesso giorno, altro orario', lungo: 'Altro evento nella stessa data, orari compatibili' }
};
export const LIBERO = { cls: 'lv-verde', testo: 'Libero', lungo: 'Nessun altro impegno' };

/** Etichetta colorata del livello (null = libero, mostrata solo se `mostraLibero`). */
export function chipLivello(livello, mostraLibero = false) {
  const l = livello ? LIVELLI[livello] : (mostraLibero ? LIBERO : null);
  return l ? h('span', { class: 'lv ' + l.cls, title: l.lungo }, l.testo) : null;
}

/** "Titolo · 21:00–23:00" per gli altri impegni che causano il conflitto. */
export function altroImpegno(c) {
  return h('span', { class: 'altro ' + (LIVELLI[c.livello]?.cls || '') }, h('b', {}, c.titolo), ' · ', orarioGiornata({ ora_inizio: c.ora_inizio, ora_fine: c.ora_fine, dopo_mezzanotte: false }));
}
