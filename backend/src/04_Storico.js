/**
 * CTRL · Registro delle modifiche.
 */
var Storico = (function () {
  var MAX = 2000;

  function short(v) {
    if (v === null || v === undefined || v === '') return '';
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > MAX ? s.slice(0, MAX) + '…' : s;
  }

  /** Solo i campi cambiati, per tenere leggibile lo storico. */
  function diff(before, after, fields) {
    var p = {}, d = {};
    fields.forEach(function (f) {
      var a = before ? (before[f] || '') : '';
      var b = after ? (after[f] || '') : '';
      if (a !== b) { p[f] = a; d[f] = b; }
    });
    return { prima: p, dopo: d, changed: Object.keys(d).length > 0 };
  }

  function log(email, eventoId, sezione, azione, rifId, prima, dopo) {
    Db.insert('storico', {
      ts: Util.nowIso(), email: email || 'sistema', evento_id: eventoId || '', sezione: sezione || '',
      azione: azione, rif_id: rifId || '', prima: short(prima), dopo: short(dopo)
    });
  }

  function forEvent(eventoId, limit) {
    return Db.all('storico')
      .filter(function (r) { return r.evento_id === eventoId; })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : -1; })
      .slice(0, limit || 50)
      .map(function (r) { return { ts: r.ts, email: r.email, sezione: r.sezione, azione: r.azione, prima: r.prima, dopo: r.dopo }; });
  }

  return { log: log, diff: diff, forEvent: forEvent };
})();
