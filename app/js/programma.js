// FILE GENERATO da scripts/build-backend.mjs a partire da backend/src/24_Programma.js: non modificarlo a mano.
/**
 * CTRL · Programma della produzione (Production Schedule): regole comuni.
 *
 * Le stesse regole sono in app/js/programma.js (l'app le usa mentre scrivi);
 * tests/backend/programma.test.mjs verifica che le due copie diano gli stessi risultati.
 *
 * - Orari "HH:MM". La giornata operativa va dalle 06:00 alle 05:59 del giorno dopo:
 *   un load-out all'01:00 resta nella giornata dello show e si ordina dopo le 23:59.
 * - Fine prima dell'inizio = attività che passa la mezzanotte.
 * - Sovrapposizione: due attività con inizio e fine che si accavallano nello stesso spazio
 *   o con lo stesso responsabile. È un avviso, non blocca nulla.
 */
var Programma = (function () {
  var ATTIVITA = ['Load-in', 'Setup', 'Stage Setup', 'Backline Setup', 'Soundcheck', 'Line Check', 'Rehearsal',
    'Doors Open', 'Show Start', 'Show End', 'Changeover', 'Break', 'Lunch', 'Dinner', 'Catering', 'Load-out',
    'Strike', 'Travel', 'Transfer', 'Meeting', 'Artist Arrival', 'Artist Departure'];
  var CUSTOM = 'Custom';
  var INIZIO_GIORNATA = 360;
  var DURATA_MAX = 12 * 60;

  function isOra(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  function minuti(s) {
    if (!isOra(s)) return null;
    var m = parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
    return m < INIZIO_GIORNATA ? m + 1440 : m;
  }

  function intervallo(a) {
    var s = minuti(a.ora_inizio);
    if (s === null) return null;
    var e = minuti(a.ora_fine);
    if (e === null) return { s: s, e: null };
    if (e <= s) e += 1440;
    return { s: s, e: e };
  }

  function nome(a) { return a.tipo === CUSTOM ? (a.attivita || '') : (a.tipo || ''); }

  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  /** Ordine cronologico; a parità di orario conta "ordine"; senza orario in fondo. */
  function ordina(lista) {
    return lista.slice().sort(function (a, b) {
      var sa = minuti(a.ora_inizio), sb = minuti(b.ora_inizio);
      if (sa === null) sa = 99999;
      if (sb === null) sb = 99999;
      if (sa !== sb) return sa - sb;
      return (parseInt(a.ordine, 10) || 0) - (parseInt(b.ordine, 10) || 0);
    });
  }

  /** Coppie di attività della stessa giornata che si accavallano. */
  function sovrapposizioni(lista) {
    var out = [];
    var l = ordina(lista);
    for (var i = 0; i < l.length; i++) {
      var a = intervallo(l[i]);
      if (!a || a.e === null) continue;
      for (var j = i + 1; j < l.length; j++) {
        var b = intervallo(l[j]);
        if (!b || b.e === null) continue;
        if (!(a.s < b.e && b.s < a.e)) continue;
        var motivo = '';
        if (l[i].spazio_id && l[i].spazio_id === l[j].spazio_id) motivo = 'spazio';
        else if (norm(l[i].responsabile) && norm(l[i].responsabile) === norm(l[j].responsabile)) motivo = 'responsabile';
        if (motivo) out.push({ a: l[i].id, b: l[j].id, motivo: motivo });
      }
    }
    return out;
  }

  function etichetta(a) { return (nome(a) || 'Attività senza nome') + (a.ora_inizio ? ' ' + a.ora_inizio : ''); }

  /** Avvisi del programma: [{ id, giornata_id, testo }]. */
  function avvisi(giornate, attivita) {
    var out = [];
    giornate.forEach(function (g) {
      var del = attivita.filter(function (a) { return a.giornata_id === g.id; });
      var giorno = g.data.slice(8, 10) + '/' + g.data.slice(5, 7);
      var perId = {};
      del.forEach(function (a) { perId[a.id] = a; });
      ordina(del).forEach(function (a) {
        if (!nome(a)) out.push({ id: a.id, giornata_id: g.id, testo: giorno + ': un\'attività non ha il tipo' });
        if (!isOra(a.ora_inizio)) out.push({ id: a.id, giornata_id: g.id, testo: giorno + ': ' + (nome(a) || 'un\'attività') + ' senza orario di inizio' });
        var iv = intervallo(a);
        if (iv && iv.e !== null && iv.e - iv.s > DURATA_MAX) out.push({ id: a.id, giornata_id: g.id, testo: giorno + ': ' + etichetta(a) + ' dura più di 12 ore, controlla gli orari' });
      });
      sovrapposizioni(del).forEach(function (c) {
        out.push({ id: c.a, altro: c.b, giornata_id: g.id, testo: giorno + ': ' + etichetta(perId[c.a]) + ' e ' + etichetta(perId[c.b]) + ' si sovrappongono (' + (c.motivo === 'spazio' ? 'stesso spazio' : 'stesso responsabile') + ')' });
      });
    });
    return out;
  }

  return {
    ATTIVITA: ATTIVITA, CUSTOM: CUSTOM, isOra: isOra, minuti: minuti, intervallo: intervallo, nome: nome,
    ordina: ordina, sovrapposizioni: sovrapposizioni, avvisi: avvisi
  };
})();

export default Programma;
