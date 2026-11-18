/**
 * Scrittore minimo di file .xlsx senza librerie: un archivio ZIP (senza compressione) con i soli file necessari.
 * Supporta più fogli, stringhe condivise, numeri, date, orari, formule con valore già calcolato, filtro automatico,
 * riga di intestazione bloccata e larghezze di colonna.
 *
 * Cella: { v, t: 's'|'n'|'d'|'t', f?: 'formula', s?: nomeStile }
 *   t 'd' → v = 'yyyy-mm-dd' (numero seriale con formato gg/mm/aaaa); t 't' → v = 'HH:MM' (frazione di giorno, formato hh:mm)
 *   con f, v è il valore calcolato conservato nel file (Excel lo ricalcola comunque all'apertura).
 */

const STILI = ['normale', 'intestazione', 'data', 'ora', 'ore', 'totale', 'totale_ore', 'intero', 'grigio'];

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const escA = (s) => esc(s).replace(/"/g, '&quot;');

export function colonna(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Numero seriale Excel di una data yyyy-mm-dd. */
export function serialeData(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

export function frazioneOra(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) / 1440;
}

// ---------- ZIP ----------
const TAB_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = TAB_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zip(files) {
  const enc = new TextEncoder();
  const parts = [], centrale = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [nome, testo] of files) {
    const n = enc.encode(nome), d = typeof testo === 'string' ? enc.encode(testo) : testo, crc = crc32(d);
    const loc = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0)]);
    parts.push(loc, n, d);
    centrale.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), n);
    offset += loc.length + n.length + d.length;
  }
  const dimCentrale = centrale.reduce((a, b) => a + b.length, 0);
  const fine = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(dimCentrale), ...u32(offset), ...u16(0)]);
  const tutto = [...parts, ...centrale, fine];
  const out = new Uint8Array(tutto.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const b of tutto) { out.set(b, p); p += b.length; }
  return out;
}

// ---------- fogli ----------
function stili() {
  // fonts: 0 normale, 1 grassetto, 2 grassetto bianco, 3 grigio
  // numFmts: 164 dd/mm/yyyy, 165 hh:mm, 166 0.00
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="9"/><color rgb="FF7F7F7F"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F385E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EDF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function xmlFoglio(foglio, indici) {
  const righe = foglio.righe;
  const ultimaCol = Math.max(...righe.map(r => r.length), 1) - 1;
  const rif = `A1:${colonna(ultimaCol)}${righe.length}`;
  const cols = foglio.larghezze ? `<cols>${foglio.larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = foglio.blocca === false ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>';
  const corpo = righe.map((riga, r) => {
    const celle = riga.map((c, i) => {
      if (c === null || c === undefined || c.v === undefined && !c.f) return '';
      const a = colonna(i) + (r + 1);
      const s = c.s ? STILI.indexOf(c.s) : 0;
      const sa = s > 0 ? ` s="${s}"` : '';
      if (c.f) {
        const cache = typeof c.v === 'number' ? `<v>${c.v}</v>` : (c.v !== undefined ? `<v>${esc(c.v)}</v>` : '');
        return `<c r="${a}"${sa}${typeof c.v === 'string' ? ' t="str"' : ''}><f>${esc(c.f)}</f>${cache}</c>`;
      }
      if (c.t === 's' || typeof c.v === 'string' && !c.t) return `<c r="${a}"${sa} t="s"><v>${indici(String(c.v))}</v></c>`;
      if (c.t === 'd') return `<c r="${a}"${sa}><v>${serialeData(c.v)}</v></c>`;
      if (c.t === 't') return `<c r="${a}"${sa}><v>${frazioneOra(c.v)}</v></c>`;
      return `<c r="${a}"${sa}><v>${c.v}</v></c>`;
    }).join('');
    return `<row r="${r + 1}"${riga.alta ? ' ht="22" customHeight="1"' : ''}>${celle}</row>`;
  }).join('');
  const filtro = foglio.filtro ? `<autoFilter ref="${rif}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${rif}"/>${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${corpo}</sheetData>${filtro}</worksheet>`;
}

/** fogli: [{ nome, righe: [[cella,...],...], larghezze?, filtro?: bool, blocca?: bool }] → Uint8Array (.xlsx) */
export function costruisciXlsx(fogli) {
  const condivise = [], mappa = new Map();
  const indici = (t) => { if (!mappa.has(t)) { mappa.set(t, condivise.length); condivise.push(t); } return mappa.get(t); };
  const xmlFogli = fogli.map(f => xmlFoglio(f, indici));
  const nomi = fogli.map(f => f.nome);
  if (nomi.some(n => n.length > 31 || /[\\/?*[\]:]/.test(n))) throw new Error('Nome del foglio non valido');
  const nomiDefiniti = fogli.map((f, i) => f.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(f.nome)}'!$A$1:$${colonna(Math.max(...f.righe.map(r => r.length), 1) - 1)}$${f.righe.length}</definedName>` : '').join('');
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${nomi.map((n, i) => `<sheet name="${escA(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${nomiDefiniti ? `<definedNames>${nomiDefiniti}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${fogli.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', stili()],
    ...xmlFogli.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${condivise.length}" uniqueCount="${condivise.length}">${condivise.map(t => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`]
  ];
  return zip(files);
}
