/**
 * Unione a tre vie dei documenti: quando due persone modificano lo stesso documento,
 * si tengono le modifiche di entrambe riga per riga e campo per campo.
 * base = ultima versione salvata che conosco, mie = le mie modifiche, loro = versione attuale sul server.
 * Sullo stesso campo vince la mia modifica. Una riga tolta da una delle due parti resta tolta.
 */
const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function unisciElemento(base, mio, loro, campi, figli) {
  const out = { id: mio.id };
  campi.forEach(c => {
    const b = base ? base[c] : undefined;
    out[c] = !base || !uguali(mio[c], b) ? mio[c] : loro[c];
  });
  Object.keys(figli || {}).forEach(k => {
    out[k] = unisciLista(base ? base[k] : [], mio[k] || [], loro[k] || [], figli[k].campi, figli[k].figli);
  });
  return out;
}

export function unisciLista(base, mie, loro, campi, figli) {
  const mappa = (l) => new Map((l || []).map(x => [x.id, x]));
  const b = mappa(base), l = mappa(loro), m = mappa(mie);
  const out = [];
  mie.forEach(r => {
    if (!b.has(r.id)) { out.push(unisciElemento(null, r, r, campi, figli)); return; }          // nuova mia
    if (!l.has(r.id)) { if (uguali(r, b.get(r.id))) return; out.push(r); return; }           // tolta da loro: resta solo se l'ho modificata
    out.push(unisciElemento(b.get(r.id), r, l.get(r.id), campi, figli));
  });
  // righe nuove di loro: dopo la riga che le precede nella loro lista, altrimenti in fondo
  (loro || []).forEach((r, i) => {
    if (b.has(r.id) || m.has(r.id)) return;
    const prec = i > 0 ? loro[i - 1].id : null;
    const pos = prec ? out.findIndex(x => x.id === prec) : -1;
    out.splice(pos >= 0 ? pos + 1 : out.length, 0, r);
  });
  return out;
}

const SCHEMI = {
  plan: { campi: [], figli: {
    crew: { campi: ['nome', 'ruolo', 'telefono', 'email'] },
    giorni: { campi: ['data'], figli: { righe: { campi: ['sez', 'ora', 'att', 'loc', 'note'] } } }
  } },
  materiali: { campi: [], figli: {
    sezioni: { campi: ['nome'], figli: { righe: { campi: ['voce', 'qta', 'unita', 'note'] } } }
  } }
};

export function unisciDocumento(tipo, base, mio, loro) {
  const s = SCHEMI[tipo];
  const out = {};
  if (tipo === 'plan') out.lingua = mio.lingua !== (base && base.lingua) ? mio.lingua : loro.lingua;
  Object.keys(s.figli).forEach(k => {
    out[k] = unisciLista(base ? base[k] : [], mio[k] || [], loro[k] || [], s.figli[k].campi, s.figli[k].figli);
  });
  return out;
}
