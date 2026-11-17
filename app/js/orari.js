/**
 * Orari scritti in fretta: "1630", "16.30", "16,30", "9", "930", "16:30" → "16:30".
 * Restituisce '' per un campo vuoto e null per un valore non riconoscibile.
 */
export function normalizzaOra(testo) {
  const t = String(testo == null ? '' : testo).trim().replace(/[.,h ]/g, ':');
  if (!t) return '';
  let hh, mm;
  let m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) { hh = +m[1]; mm = +m[2]; if (m[2].length === 1) mm *= 10; }
  else if ((m = t.match(/^(\d{1,4})$/))) {
    const d = m[1];
    if (d.length <= 2) { hh = +d; mm = 0; }
    else { hh = +d.slice(0, d.length - 2); mm = +d.slice(-2); }
  } else return null;
  if (hh === 24 && mm === 0) hh = 0;
  if (hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/** Somma minuti a un orario "HH:MM" (sul giro delle 24 ore). */
export function sommaMinuti(ora, minuti) {
  const [h, m] = ora.split(':').map(Number);
  const t = ((h * 60 + m + minuti) % 1440 + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
