import { costruisciXlsx } from './xlsx.js';

const MESI_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const GIORNI_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** STAFF_WORK_REPORT_NOVEMBER_2026.xlsx · senza mese STAFF_WORK_REPORT_2026.xlsx · senza anno STAFF_WORK_REPORT_ALL.xlsx */
export function nomeFileReport(periodo) {
  const anno = periodo && periodo.anno, mese = periodo && periodo.mese;
  const parti = ['STAFF_WORK_REPORT'];
  if (anno) { if (mese) parti.push(MESI_EN[Number(mese) - 1]); parti.push(anno); } else parti.push('ALL');
  return parti.join('_') + '.xlsx';
}

const giornoEn = (iso) => GIORNI_EN[new Date(iso + 'T12:00:00Z').getUTCDay()];
const ore2 = (n) => Math.round(n * 100) / 100;
const testo = (v) => (v ? { v, t: 's' } : null);
const durata = (r) => (r.durata_min === null || r.durata_min === undefined ? 0 : r.durata_min / 60);

/**
 * Tre fogli: WORK LOG (una riga per tecnico e giornata), TECHNICIAN SUMMARY, EVENT SUMMARY.
 * Le ore sono formule (con il valore già calcolato), così il file resta corretto se si modifica un orario.
 * Gli eventi annullati non vengono esportati (non entrano nei totali): ne viene indicato il numero in fondo al riepilogo.
 */
export function costruisciReport(righe) {
  const vive = righe.filter(r => !r.annullato);
  const annullate = righe.length - vive.length;
  const n = vive.length;
  const ultima = Math.max(n + 1, 2);

  const log = [[
    ...['Date', 'Day', 'First Name', 'Last Name', 'Event', 'Location', 'Start', 'End', 'Total Hours', 'Notes', 'Event ID'].map(v => ({ v, t: 's', s: 'intestazione' }))
  ]];
  vive.forEach((r, i) => {
    const x = i + 2;
    log.push([
      { v: r.data, t: 'd', s: 'data' }, { v: giornoEn(r.data), t: 's' }, { v: r.nome, t: 's' }, { v: r.cognome, t: 's' },
      { v: r.evento, t: 's' }, testo(r.location),
      r.ora_inizio ? { v: r.ora_inizio, t: 't', s: 'ora' } : null, r.ora_fine ? { v: r.ora_fine, t: 't', s: 'ora' } : null,
      { f: `IF(OR(G${x}="",H${x}=""),0,IF(H${x}<=G${x},H${x}+1-G${x},H${x}-G${x})*24)`, v: ore2(durata(r)), s: 'ore' },
      testo(r.nota), { v: r.evento_id, t: 's', s: 'grigio' }
    ]);
  });

  // riepilogo per tecnico (stesso nome e cognome = stessa riga, come nelle formule)
  const tec = new Map();
  vive.forEach(r => { const k = r.nome + '\u0001' + r.cognome; const t = tec.get(k) || { nome: r.nome, cognome: r.cognome, giorni: 0, ore: 0 }; t.giorni++; t.ore += durata(r); tec.set(k, t); });
  const tecList = [...tec.values()].sort((a, b) => (a.cognome + a.nome).localeCompare(b.cognome + b.nome, 'it'));
  const C = `'WORK LOG'!$C$2:$C$${ultima}`, D = `'WORK LOG'!$D$2:$D$${ultima}`, I = `'WORK LOG'!$I$2:$I$${ultima}`, K = `'WORK LOG'!$K$2:$K$${ultima}`;
  const sumT = [['First Name', 'Last Name', 'Days Worked', 'Total Hours'].map(v => ({ v, t: 's', s: 'intestazione' }))];
  tecList.forEach((t, i) => {
    const x = i + 2;
    sumT.push([{ v: t.nome, t: 's' }, { v: t.cognome, t: 's' },
      { f: `COUNTIFS(${C},A${x},${D},B${x})`, v: t.giorni, s: 'intero' },
      { f: `SUMIFS(${I},${C},A${x},${D},B${x})`, v: ore2(t.ore), s: 'ore' }]);
  });
  const ft = tecList.length + 1;
  sumT.push([{ v: 'TOTAL', t: 's', s: 'totale' }, { s: 'totale', v: '', t: 's' },
    { f: `SUM(C2:C${Math.max(ft, 2)})`, v: tecList.reduce((a, t) => a + t.giorni, 0), s: 'totale' },
    { f: `SUM(D2:D${Math.max(ft, 2)})`, v: ore2(tecList.reduce((a, t) => a + t.ore, 0)), s: 'totale_ore' }]);
  if (annullate) sumT.push([{ v: `Cancelled events excluded: ${annullate} work day${annullate === 1 ? '' : 's'}`, t: 's', s: 'grigio' }]);

  // riepilogo per evento
  const ev = new Map();
  vive.forEach(r => { const e = ev.get(r.evento_id) || { id: r.evento_id, titolo: r.evento, location: r.location, data: r.data, giorni: 0, ore: 0 }; e.giorni++; e.ore += durata(r); if (r.data < e.data) e.data = r.data; ev.set(r.evento_id, e); });
  const evList = [...ev.values()].sort((a, b) => a.data.localeCompare(b.data) || a.titolo.localeCompare(b.titolo, 'it'));
  const sumE = [['Event', 'First Date', 'Location', 'Technician Days', 'Total Hours', 'Event ID'].map(v => ({ v, t: 's', s: 'intestazione' }))];
  evList.forEach((e, i) => {
    const x = i + 2;
    sumE.push([{ v: e.titolo, t: 's' }, { v: e.data, t: 'd', s: 'data' }, { v: e.location, t: 's' },
      { f: `COUNTIF(${K},F${x})`, v: e.giorni, s: 'intero' }, { f: `SUMIF(${K},F${x},${I})`, v: ore2(e.ore), s: 'ore' }, { v: e.id, t: 's', s: 'grigio' }]);
  });
  const fe = evList.length + 1;
  sumE.push([{ v: 'TOTAL', t: 's', s: 'totale' }, { s: 'totale', v: '', t: 's' }, { s: 'totale', v: '', t: 's' },
    { f: `SUM(D2:D${Math.max(fe, 2)})`, v: evList.reduce((a, e) => a + e.giorni, 0), s: 'totale' },
    { f: `SUM(E2:E${Math.max(fe, 2)})`, v: ore2(evList.reduce((a, e) => a + e.ore, 0)), s: 'totale_ore' }]);

  return costruisciXlsx([
    { nome: 'WORK LOG', righe: log, filtro: true, larghezze: [12, 12, 14, 18, 34, 28, 9, 9, 12, 30, 12] },
    { nome: 'TECHNICIAN SUMMARY', righe: sumT, larghezze: [16, 20, 13, 13] },
    { nome: 'EVENT SUMMARY', righe: sumE, larghezze: [36, 12, 28, 16, 13, 12] }
  ]);
}
