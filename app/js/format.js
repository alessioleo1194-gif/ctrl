const GIORNI = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Date ISO (yyyy-mm-dd) gestite a mezzogiorno UTC: nessuno slittamento di fuso. */
export function parse(iso) { return new Date(iso + 'T12:00:00Z'); }

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

export function dayParts(iso) {
  const d = parse(iso);
  return { wd: GIORNI[d.getUTCDay()], day: d.getUTCDate(), month: MESI[d.getUTCMonth()], year: d.getUTCFullYear() };
}

export function monthLabel(iso) {
  const p = dayParts(iso);
  return `${p.month} ${p.year}`;
}

export function longDate(iso) {
  const d = parse(iso);
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shortDate(iso) {
  const d = parse(iso);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function dateRange(e) {
  if (e.data_fine && e.data_fine !== e.data) return `${longDate(e.data)} → ${longDate(e.data_fine)}`;
  return longDate(e.data);
}

export function timeRange(e) {
  if (e.ora_inizio && e.ora_fine) return `${e.ora_inizio}–${e.ora_fine}`;
  return e.ora_inizio || '';
}

export function stamp(iso) {
  if (!iso) return '';
  const [d, t] = iso.split('T');
  return `${shortDate(d)} ${t ? t.slice(0, 5) : ''}`.trim();
}

/** yyyy-mm-dd → dd/mm/yyyy. */
export function dataIt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}

/** Sostituisce nel testo le date yyyy-mm-dd con dd/mm/yyyy. */
export function dateNelTesto(t) {
  return String(t || '').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1');
}

/** Descrizione breve di un dispositivo dal suo user agent, es. "iPhone · Safari". */
export function dispositivo(ua) {
  const s = String(ua || '');
  if (!s) return '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox|FxiOS/.test(s) ? 'Firefox'
    : /Chrome|CriOS/.test(s) ? 'Chrome' : /Safari/.test(s) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || s.slice(0, 30);
}

/** "giovedì 26 novembre" in maiuscolo, per le intestazioni delle giornate. */
export function giornoLungo(iso) {
  return parse(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).toUpperCase();
}

/** Orario di una giornata o di un turno: "21:00–23:00", "dalle 21:00", "fino alle 23:00", "da definire". */
export function orarioGiornata(g) {
  const i = g.ora_inizio || '', f = g.ora_fine || '';
  if (i && f) return `${i}–${f}` + (g.dopo_mezzanotte ? ' (+1)' : '');
  if (i) return 'dalle ' + i;
  if (f) return 'fino alle ' + f;
  return 'orario da definire';
}
