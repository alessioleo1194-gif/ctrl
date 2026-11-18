/** Export Excel: nome del file, struttura dello ZIP e dei fogli. La validazione con Excel/LibreOffice si fa a parte. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { costruisciReport, nomeFileReport } from '../../app/js/report-xlsx.js';
import { crc32, colonna, serialeData } from '../../app/js/xlsx.js';

const riga = (o) => ({ data: '2026-11-10', nome: 'Marco', cognome: 'Serra', evento: 'Concerto', evento_id: 'ev1', location: 'Lecce', ora_inizio: '21:00', ora_fine: '23:30', durata_min: 150, nota: '', annullato: false, ...o });

/** Legge l'archivio dalla directory centrale: nome → contenuto (verifica anche il CRC). */
function leggiZip(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = b.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), ln = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(b.subarray(p + 46, p + 46 + ln));
    const lnl = v.getUint16(off + 26, true), lel = v.getUint16(off + 28, true);
    const dati = b.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + size);
    assert.equal(crc32(dati), crc, 'CRC di ' + nome);
    out[nome] = new TextDecoder().decode(dati);
    p += 46 + ln;
  }
  return out;
}

test('nome del file: STAFF_WORK_REPORT_NOVEMBER_2026.xlsx', () => {
  assert.equal(nomeFileReport({ anno: '2026', mese: '11' }), 'STAFF_WORK_REPORT_NOVEMBER_2026.xlsx');
  assert.equal(nomeFileReport({ anno: '2027', mese: '01' }), 'STAFF_WORK_REPORT_JANUARY_2027.xlsx');
  assert.equal(nomeFileReport({ anno: '2026', mese: '' }), 'STAFF_WORK_REPORT_2026.xlsx');
  assert.equal(nomeFileReport({}), 'STAFF_WORK_REPORT_ALL.xlsx');
});

test('colonne e date seriali', () => {
  assert.deepEqual([0, 25, 26, 27, 701].map(colonna), ['A', 'Z', 'AA', 'AB', 'ZZ']);
  assert.equal(serialeData('2026-11-10'), 46336);
  assert.equal(serialeData('1900-03-01'), 61);
});

test('xlsx: tre fogli, formule con valore, filtro, riga bloccata, annullati esclusi', () => {
  const b = costruisciReport([
    riga({}), riga({ data: '2026-11-11', durata_min: 240, ora_inizio: '22:00', ora_fine: '02:00', nome: 'Anna', cognome: 'Maria De Luca', evento: 'Notte & "luci"', evento_id: 'ev2' }),
    riga({ data: '2026-11-12', ora_inizio: '', ora_fine: '', durata_min: null }), riga({ annullato: true, evento_id: 'ev3' })
  ]);
  assert.deepEqual([...b.subarray(0, 2)], [0x50, 0x4b]);
  const z = leggiZip(b);
  assert.deepEqual(Object.keys(z).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']);
  assert.match(z['xl/workbook.xml'], /name="WORK LOG"/);
  assert.match(z['xl/workbook.xml'], /name="TECHNICIAN SUMMARY"/);
  assert.match(z['xl/workbook.xml'], /name="EVENT SUMMARY"/);
  assert.match(z['xl/workbook.xml'], /_xlnm\._FilterDatabase/);
  const log = z['xl/worksheets/sheet1.xml'];
  assert.match(log, /state="frozen"/);
  assert.match(log, /<autoFilter ref="A1:K4"\/>/, 'tre righe (l\'annullata non c\'è) più l\'intestazione');
  assert.match(log, /<f>IF\(OR\(G2="",H2=""\),0,IF\(H2&lt;=G2,H2\+1-G2,H2-G2\)\*24\)<\/f><v>2\.5<\/v>/);
  assert.match(log, /<f>[^<]*H3&lt;=G3[^<]*<\/f><v>4<\/v>/, 'la notte 22:00–02:00 vale 4 ore');
  assert.match(log, /<f>IF\(OR\(G4="",H4=""\)[^<]*<\/f><v>0<\/v>/, 'senza orari: 0 ore, riga presente');
  assert.match(log, /<v>46336<\/v>/);
  assert.match(z['xl/sharedStrings.xml'], /Notte &amp; "luci"/);
  const t = z['xl/worksheets/sheet2.xml'];
  assert.match(t, /COUNTIFS\('WORK LOG'!\$C\$2:\$C\$4,A2,'WORK LOG'!\$D\$2:\$D\$4,B2\)/);
  assert.match(t, /<f>SUM\(D2:D3\)<\/f><v>6\.5<\/v>/);
  assert.match(z['xl/sharedStrings.xml'], /Cancelled events excluded: 1 work day/);
  assert.match(z['xl/worksheets/sheet3.xml'], /COUNTIF\('WORK LOG'!\$K\$2:\$K\$4,F2\)/);
});

test('xlsx: senza righe il file è comunque valido', () => {
  const z = leggiZip(costruisciReport([]));
  assert.match(z['xl/worksheets/sheet1.xml'], /<row r="1">/);
});
