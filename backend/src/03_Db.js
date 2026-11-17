/**
 * CTRL · Accesso al foglio.
 *
 * È l'UNICO modulo che parla con SpreadsheetApp: per migrare a un database
 * diverso in futuro si riscrive solo questo file.
 */
var Db = (function () {
  var ssCache = null;
  var tableCache = {};

  function ss() {
    if (!ssCache) ssCache = SpreadsheetApp.openById(Config.require('DB_ID'));
    return ssCache;
  }

  function sheet(name) {
    var sh = ss().getSheetByName(name);
    if (!sh) throw new CtrlError('SERVER', 'Tabella mancante: ' + name + '. Esegui il setup.');
    return sh;
  }

  /** Legge una tabella: righe come oggetti con _row (numero di riga nel foglio). */
  function read(name) {
    if (tableCache[name]) return tableCache[name];
    var sh = sheet(name);
    var values = sh.getDataRange().getValues();
    var head = values[0].map(String);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var empty = true;
      var obj = { _row: r + 1 };
      for (var c = 0; c < head.length; c++) {
        if (!head[c]) continue;
        var v = row[c];
        if (v instanceof Date) v = Util.fmtDate(v);
        v = v === null || v === undefined ? '' : String(v);
        if (v !== '') empty = false;
        obj[head[c]] = v;
      }
      if (!empty) rows.push(obj);
    }
    var t = { name: name, sheet: sh, head: head, rows: rows };
    tableCache[name] = t;
    return t;
  }

  function all(name) {
    return read(name).rows.slice();
  }

  function find(name, field, value) {
    var rows = read(name).rows;
    for (var i = 0; i < rows.length; i++) if (rows[i][field] === String(value)) return rows[i];
    return null;
  }

  function toRow(head, obj) {
    return head.map(function (h) {
      var v = obj[h];
      return v === null || v === undefined ? '' : String(v);
    });
  }

  function insert(name, obj) {
    var t = read(name);
    var values = toRow(t.head, obj);
    var rowNum = t.sheet.getLastRow() + 1;
    var range = t.sheet.getRange(rowNum, 1, 1, t.head.length);
    range.setNumberFormat('@');
    range.setValues([values]);
    var copy = {};
    t.head.forEach(function (h, i) { copy[h] = values[i]; });
    copy._row = rowNum;
    t.rows.push(copy);
    return copy;
  }

  /**
   * Aggiorna una riga trovata per chiave. Se expectedVersion è indicato e non
   * coincide, rifiuta con CONFLICT (qualcun altro ha salvato prima).
   */
  function update(name, keyField, keyValue, patch, expectedVersion, keepVersion) {
    var t = read(name);
    var row = find(name, keyField, keyValue);
    if (!row) throw new CtrlError('NOT_FOUND', 'Elemento non trovato');
    if (expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== String(row.versione || '0')) {
      throw new CtrlError('CONFLICT', 'Modificato da un altro utente. Ricarica e riprova.', { attuale: row });
    }
    var next = {};
    t.head.forEach(function (h) { next[h] = row[h]; });
    Object.keys(patch).forEach(function (k) { if (t.head.indexOf(k) >= 0) next[k] = patch[k]; });
    // keepVersion: campi tecnici (es. cartella Drive) che non devono invalidare le modifiche aperte da altri.
    if (t.head.indexOf('versione') >= 0 && !keepVersion) next.versione = String((parseInt(row.versione, 10) || 0) + 1);
    var values = toRow(t.head, next);
    var range = t.sheet.getRange(row._row, 1, 1, t.head.length);
    range.setNumberFormat('@');
    range.setValues([values]);
    t.head.forEach(function (h, i) { row[h] = values[i]; });
    return row;
  }

  /** Cancellazione fisica: usata solo per le sessioni scadute. */
  function removeRow(name, keyField, keyValue) {
    var t = read(name);
    var row = find(name, keyField, keyValue);
    if (!row) return false;
    t.sheet.deleteRow(row._row);
    delete tableCache[name];
    return true;
  }

  /**
   * Cancellazione fisica delle righe che soddisfano pred: solo per tabelle di servizio con scadenza
   * (sessioni, registro accessi, richieste chiuse). Da chiamare dentro withLock. Ritorna quante righe toglie.
   */
  function removeWhere(name, pred) {
    var t = read(name);
    var rows = t.rows.filter(pred).sort(function (a, b) { return b._row - a._row; });
    rows.forEach(function (r) { t.sheet.deleteRow(r._row); });
    delete tableCache[name];
    return rows.length;
  }

  function clearCache() {
    tableCache = {};
    ssCache = null;
  }

  /** Blocco per le scritture: una sola scrittura alla volta su tutto il database. */
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new CtrlError('BUSY', 'Sistema occupato, riprova tra qualche secondo.');
    try {
      clearCache();
      return fn();
    } finally {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }

  return {
    ss: ss, sheet: sheet, all: all, find: find, insert: insert, update: update,
    removeRow: removeRow, removeWhere: removeWhere, clearCache: clearCache, withLock: withLock
  };
})();
