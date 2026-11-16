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
