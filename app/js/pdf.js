import { testoPdf } from './documento-dati.js';

/**
 * PDF del Production Schedule con jsPDF + jspdf-autotable, copiati in app/vendor
 * (versioni bloccate, nessun CDN). Si caricano solo quando serve un PDF.
 */
const LIBRERIE = ['/vendor/jspdf-4.2.1.umd.min.js', '/vendor/jspdf-autotable-5.0.9.min.js'];
let caricamento = null;

function script(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error('libreria PDF non disponibile (sei offline?)'));
    document.head.append(s);
  });
}

function carica() {
  if (!caricamento) {
    caricamento = LIBRERIE.reduce((p, src) => p.then(() => script(src)), Promise.resolve())
      .then(() => { if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('libreria PDF non caricata'); return window.jspdf.jsPDF; })
      .catch(e => { caricamento = null; throw e; });
  }
  return caricamento;
}

// Colori del documento (come il modello di Alessio): blu scuro per titoli e intestazioni
const BLU = [31, 56, 94];
const GRIGIO = [90, 98, 110];
const LINEA = [60, 66, 76];

const AZZURRO = [221, 229, 241];

/** Crea il PDF di un documento (plan o materiali) e lo scarica. Restituisce il documento jsPDF (usato dai test). */
export async function creaPdf(d, nome) {
  const jsPDF = await carica();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.setProperties({ title: testoPdf(d.titolo + ' · ' + d.nomeEvento), creator: 'CTRL' });
  const M = 15;
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  let y = M + 5;

  pdf.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...BLU);
  pdf.text(testoPdf(d.titolo), M, y);
  y += 9;

  pdf.setFontSize(10).setTextColor(20, 20, 20);
  d.intestazione.forEach(([k, v]) => {
    const etichetta = testoPdf(k + ': ');
    pdf.setFont('helvetica', 'bold');
    const lw = pdf.getTextWidth(etichetta);
    pdf.text(etichetta, M, y);
    pdf.setFont('helvetica', 'normal');
    const righe = pdf.splitTextToSize(testoPdf(v), W - 2 * M - lw);
    pdf.text(righe, M + lw, y);
    y += 5.2 * righe.length;
  });
  y += 3;

  const stile = {
    theme: 'grid', margin: { left: M, right: M, bottom: M + 6 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: [20, 20, 20], lineColor: LINEA, lineWidth: 0.2, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: BLU, textColor: [255, 255, 255], fontStyle: 'bold' }
  };
  const titolo = (t, dim = 13) => {
    if (y > H - 40) { pdf.addPage(); y = M + 5; }
    pdf.setFont('helvetica', 'bold').setFontSize(dim).setTextColor(...BLU);
    pdf.text(testoPdf(t), M, y);
    y += 3;
  };
  const vuoto = (t) => {
    pdf.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...GRIGIO);
    y += 4; pdf.text(testoPdf(t), M, y); y += 6;
  };
  const banda = (nome, colonne) => [{ content: testoPdf(nome.toUpperCase()), colSpan: colonne, styles: { fillColor: AZZURRO, textColor: BLU, fontStyle: 'bold' } }];

  if (d.tipo === 'plan') {
    if (d.crew.length) {
      titolo(d.crewTitolo);
      pdf.autoTable({ ...stile, startY: y, head: [d.colCrew.map(testoPdf)], body: d.crew.map(r => r.map(testoPdf)) });
      y = pdf.lastAutoTable.finalY + 7;
    }
    titolo(d.scheduleTitolo);
    d.giorni.forEach(g => {
      if (g.titolo) { y += 4; titolo(g.titolo, 11); }
      if (!g.sezioni.length) { vuoto(d.T.vuoto); return; }
      const body = [];
      g.sezioni.forEach(s => { body.push(banda(s.nome, 4)); s.righe.forEach(r => body.push(r.map(testoPdf))); });
      pdf.autoTable({
        ...stile, startY: y + 1, head: [d.colSchedule.map(testoPdf)], body,
        columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 44 }, 2: { cellWidth: 34 } }
      });
      y = pdf.lastAutoTable.finalY + 6;
    });
  } else {
    if (!d.sezioni.length) vuoto(d.T.vuotoM);
    d.sezioni.forEach(s => {
      if (y > H - 50) { pdf.addPage(); y = M + 5; }
      titolo(s.nome);
      pdf.autoTable({
        ...stile, startY: y + 1, head: [d.colonne.map(testoPdf)], body: s.righe.map(r => r.map(testoPdf)),
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 20, halign: 'right' } }
      });
      y = pdf.lastAutoTable.finalY + 7;
    });
  }

  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIGIO);
    pdf.text(testoPdf(d.aggiornato), M, H - 8);
    pdf.text(testoPdf(`${d.T.pagina} ${i} ${d.T.di} ${n}`), W - M, H - 8, { align: 'right' });
  }
  pdf.save(nome);
  return pdf;
}
