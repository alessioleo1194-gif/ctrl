import { api } from './api.js';
import { h, icon } from './ui.js';
import { store } from './app.js';
import { monthLabel } from './format.js';

/**
 * Popup sul nome di un tecnico (solo Owner): giornate lavorate, giornate future, ore lavorate del mese corrente.
 * Desktop: compare passando il cursore; telefono e tablet: compare toccando il nome (e il tocco non apre l'evento).
 * Si chiude con Esc, toccando fuori o con la X. I numeri si rileggono dal server (al massimo ogni 30 secondi).
 */
const TTL = 30000;
let cache = null;
let aperto = null;     // { el, ancora, chiudi }
let seq = 0;

export function oreHM(ore) {
  const min = Math.round((Number(ore) || 0) * 60);
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh} h ${String(mm).padStart(2, '0')} min` : `${hh} h`;
}

async function numeri() {
  if (cache && Date.now() - cache.t < TTL) return cache;
  const r = await api('report.statistiche', {});
  cache = { t: Date.now(), mese: r.mese, per: Object.fromEntries(r.persone.map(p => [p.id, p])) };
  return cache;
}

export function dimenticaStatistiche() { cache = null; }

function chiudi() {
  if (aperto) { aperto.el.remove(); aperto = null; }
  seq++;
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudi(); });
document.addEventListener('pointerdown', (e) => { if (aperto && !aperto.el.contains(e.target) && !aperto.ancora.contains(e.target)) chiudi(); }, true);
window.addEventListener('scroll', () => { if (aperto && !aperto.sheet) chiudi(); }, true);
window.addEventListener('hashchange', chiudi);

function posiziona(pop, ancora) {
  const r = ancora.getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let y = r.bottom + 6;
  if (y + ht > window.innerHeight - 8) y = Math.max(8, r.top - ht - 6);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}

async function apri(ancora, persona) {
  if (aperto && aperto.ancora === ancora) return;
  chiudi();
  const mio = ++seq;
  const sheet = window.matchMedia('(max-width: 700px)').matches;
  const corpo = h('div', { class: 'sp-corpo' }, h('span', { class: 'help' }, 'Caricamento…'));
  const el = h('div', { class: 'stat-pop' + (sheet ? ' sheet-m' : ''), role: 'dialog', 'aria-label': 'Statistiche di ' + persona.nome },
    h('div', { class: 'sp-testa' }, h('b', {}, persona.nome.toUpperCase()),
      sheet ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Chiudi', onclick: chiudi }, icon('x')) : null),
    corpo);
  document.body.append(el);
  aperto = { el, ancora, sheet };
  if (!sheet) posiziona(el, ancora);
  try {
    const c = await numeri();
    if (mio !== seq) return;
    const s = c.per[persona.id] || { giornate_lavorate: 0, giornate_future: 0, ore_lavorate: 0 };
    corpo.replaceChildren(
      h('div', { class: 'label' }, 'Mese corrente · ' + monthLabel(c.mese + '-01')),
      h('dl', { class: 'sp-dl' },
        h('dt', {}, 'Giornate lavorate'), h('dd', { 'data-k': 'lavorate' }, String(s.giornate_lavorate)),
        h('dt', {}, 'Giornate future'), h('dd', { 'data-k': 'future' }, String(s.giornate_future)),
        h('dt', {}, 'Ore lavorate'), h('dd', { 'data-k': 'ore' }, oreHM(s.ore_lavorate))));
    if (!sheet) posiziona(el, ancora);
  } catch (e) {
    if (mio === seq) corpo.replaceChildren(h('span', { class: 'help' }, 'Statistiche non disponibili'));
  }
}

/** Collega il popup a un nome (solo Owner e solo se la persona ha un id). */
export function collegaStatistiche(el, persona) {
  if (!store.user?.permessi?.admin || !persona.id) return;
  el.classList.add('has-stat');
  let tipo = 'mouse', timer = 0;
  el.addEventListener('pointerdown', (e) => { tipo = e.pointerType || 'mouse'; });
  el.addEventListener('mouseenter', () => {
    if (window.matchMedia('(hover: none)').matches) return;
    clearTimeout(timer); timer = setTimeout(() => apri(el, persona), 120);
  });
  el.addEventListener('mouseleave', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (aperto && aperto.ancora === el && !aperto.el.matches(':hover')) chiudi(); }, 160);
    void e;
  });
  el.addEventListener('click', (e) => {
    if (tipo === 'mouse' && !window.matchMedia('(hover: none)').matches) return;   // col mouse il clic apre l'evento
    e.stopPropagation(); e.preventDefault();
    if (aperto && aperto.ancora === el) chiudi(); else apri(el, persona);
  });
}
