import { h } from './ui.js';
import { store } from './app.js';

/** Colori delle persone: stessi nomi del backend (COLORI_UTENTE). */
export const COLORI = [['blu', 'Blu'], ['verde', 'Verde'], ['arancio', 'Arancio'], ['viola', 'Viola'], ['rosa', 'Rosa'], ['turchese', 'Turchese'], ['giallo', 'Giallo'], ['rosso', 'Rosso']];

export function primoNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '?';
}

export function iniziali(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Etichetta colorata con il primo nome; piena se è la persona che sta guardando. */
export function nomeTag(p) {
  const io = !!(p.id && store.user && p.id === store.user.id);
  return h('span', { class: 'nm pc-' + p.colore + (io ? ' me' : ''), title: p.nome + (io ? ' (tu)' : '') }, primoNome(p.nome));
}

/** Nomi dello staff per le card: i primi due e "+N". */
export function staffNomi(staff, max = 2) {
  const out = staff.slice(0, max).map(nomeTag);
  if (staff.length > max) {
    out.push(h('span', { class: 'nm more', title: staff.slice(max).map(s => s.nome).join(', ') }, '+' + (staff.length - max)));
  }
  return out;
}
