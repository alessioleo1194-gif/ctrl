/**
 * Testo tabulato come lo copia Excel: righe separate da a-capo, celle da tabulazione,
 * celle con tab/a-capo/virgolette racchiuse tra virgolette (con "" per le virgolette).
 */
export function leggiTsv(testo) {
  const s = String(testo == null ? '' : testo).replace(/\r\n?/g, '\n');
  const righe = [];
  let riga = [], cella = '', inVirgolette = false, i = 0, daVirgolette = false;
  while (i < s.length) {
    const c = s[i];
    if (inVirgolette) {
      if (c === '"') {
        if (s[i + 1] === '"') { cella += '"'; i += 2; continue; }
        inVirgolette = false; i++; continue;
      }
      cella += c; i++; continue;
    }
    if (c === '"' && cella === '' && !daVirgolette) { inVirgolette = true; daVirgolette = true; i++; continue; }
    if (c === '\t') { riga.push(cella); cella = ''; daVirgolette = false; i++; continue; }
    if (c === '\n') { riga.push(cella); righe.push(riga); riga = []; cella = ''; daVirgolette = false; i++; continue; }
    cella += c; i++;
  }
  // l'ultimo a-capo di Excel non crea una riga vuota in più
  if (cella !== '' || riga.length || daVirgolette) { riga.push(cella); righe.push(riga); }
  return righe;
}

export function scriviTsv(matrice) {
  const cella = (v) => {
    const t = String(v == null ? '' : v);
    return /[\t\n\r"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return matrice.map(r => r.map(cella).join('\t')).join('\n');
}
