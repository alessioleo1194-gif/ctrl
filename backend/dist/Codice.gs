/**
 * CTRL API · versione 0.7.0
 * FILE GENERATO da scripts/build-backend.mjs a partire da backend/src: non modificarlo a mano.
 * Per aggiornare il server: incolla tutto il contenuto al posto di Codice.gs nell'editor Apps Script,
 * salva, poi Esegui il deployment > Gestisci deployment > modifica > Nuova versione.
 */

// ===== 00_Config.js =====
/**
 * CTRL · Configurazione dell'ambiente.
 *
 * Gli ID di Drive e Calendar NON sono scritti nel codice: vivono nelle
 * Proprietà dello script (Impostazioni progetto > Proprietà script),
 * impostate una sola volta dalle funzioni setupProduzione() / setupTest()
 * in 90_Setup.js.
 */
var CTRL_VERSION = '0.7.0';
var CTRL_TZ = 'Europe/Rome';

var Config = (function () {
  var cache = null;

  function all() {
    if (!cache) cache = PropertiesService.getScriptProperties().getProperties();
    return cache;
  }

  function get(key, fallback) {
    var v = all()[key];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  function require_(key) {
    var v = get(key);
    if (!v) throw new CtrlError('SERVER', 'Configurazione mancante: ' + key + '. Esegui la funzione di setup.');
    return v;
  }

  function setAll(obj) {
    PropertiesService.getScriptProperties().setProperties(obj, false);
    cache = null;
  }

  function reset() {
    cache = null;
  }

  return { get: get, require: require_, setAll: setAll, reset: reset };
})();

// ===== 01_Util.js =====
/**
 * CTRL · Utilità comuni: errori, id, hash, date.
 */

/** Errore applicativo con codice stabile, inviato al frontend senza dettagli interni. */
function CtrlError(code, message, extra) {
  this.name = 'CtrlError';
  this.code = code;
  this.message = message;
  this.extra = extra || null;
}
CtrlError.prototype = Object.create(Error.prototype);
CtrlError.prototype.constructor = CtrlError;

var Util = (function () {
  function uuidHex() {
    return Utilities.getUuid().replace(/-/g, '');
  }

  /** Id leggibile e mai interpretabile come numero dal foglio (prefisso di lettere). */
  function newId(prefix) {
    return prefix + '_' + uuidHex().slice(0, 12);
  }

  /** Token casuale non prevedibile (~240 bit). */
  function newToken() {
    return uuidHex() + uuidHex();
  }

  function sha256(text) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = (bytes[i] + 256) % 256;
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  /** Codice numerico a 6 cifre. */
  function newCode() {
    var n = parseInt(uuidHex().slice(0, 12), 16) % 1000000;
    return ('000000' + n).slice(-6);
  }

  function nowIso() {
    return Utilities.formatDate(new Date(), CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }

  function fmtDate(d) {
    return Utilities.formatDate(d, CTRL_TZ, 'yyyy-MM-dd');
  }

  function fmtTime(d) {
    return Utilities.formatDate(d, CTRL_TZ, 'HH:mm');
  }

  function addDays(isoDate, n) {
    var p = isoDate.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  function isEmail(s) {
    return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
  }

  function normEmail(s) {
    return String(s || '').trim().toLowerCase();
  }

  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rifiuta date inesistenti come il 30 febbraio
  }

  function isTime(s) {
    return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  }

  function isColor(s) {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
  }

  /** Testo pulito, lunghezza massima, niente caratteri di controllo. */
  function text(s, max) {
    if (s === null || s === undefined) return '';
    var t = String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    return t.length > max ? t.slice(0, max) : t;
  }

  /** Rimuove i tag HTML dalle descrizioni del Calendar. */
  function stripHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function bool(v) {
    return v === true || v === 'TRUE' || v === 'true' || v === 'SI' || v === 'Sì' || v === 1 || v === '1';
  }

  return {
    newId: newId, newToken: newToken, newCode: newCode, sha256: sha256,
    nowIso: nowIso, fmtDate: fmtDate, fmtTime: fmtTime, addDays: addDays,
    isEmail: isEmail, normEmail: normEmail, isDate: isDate, isTime: isTime, isColor: isColor,
    text: text, stripHtml: stripHtml, bool: bool
  };
})();

// ===== 02_Schema.js =====
/**
 * CTRL · Struttura del database (una scheda del foglio per tabella).
 *
 * Regole:
 * - le colonne si AGGIUNGONO in fondo, mai rinominate o tolte (setup è idempotente);
 * - ogni cella è testo (formato "@"), così id, date e orari non vengono convertiti;
 * - nessuna riga viene cancellata: si usa stato/eliminato.
 */
var SCHEMA_VERSION = 4;

var SCHEMA = {
  eventi: ['id', 'origine', 'cal_key', 'titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo',
    'descrizione', 'colore', 'progetto_id', 'cartella_id', 'stato', 'note',
    'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'versione', 'sync_il'],
  // programma della produzione (Production Schedule). evento_id resta per compatibilità, non si usa più.
  attivita: ['id', 'evento_id', 'ora_inizio', 'ora_fine', 'attivita', 'responsabile', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione', 'progetto_id', 'giornata_id', 'spazio_id', 'tipo'],
  materiale: ['id', 'evento_id', 'voce', 'quantita', 'area', 'provenienza', 'fornitore', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  canali: ['id', 'evento_id', 'numero', 'sorgente', 'microfono', 'di', 'asta', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  testi: ['id', 'evento_id', 'sezione', 'testo', 'aggiornato_il', 'aggiornato_da', 'versione'],
  allegati: ['id', 'evento_id', 'sezione', 'drive_id', 'nome', 'mime', 'byte', 'caricato_da', 'caricato_il',
    'nel_cestino'],
  // progetti = produzioni (scheda di produzione): uno o più eventi collegati con eventi.progetto_id
  progetti: ['id', 'nome', 'tipo', 'data', 'data_fine', 'cartella_id', 'stato', 'creato_il', 'aggiornato_il',
    'versione', 'creato_da', 'aggiornato_da', 'eliminato', 'note'],
  // location = spazi della produzione (palchi, sale, magazzino, venue)
  location: ['id', 'progetto_id', 'nome', 'indirizzo', 'note', 'versione', 'tipo', 'ordine', 'eliminato', 'creato_il',
    'aggiornato_il', 'aggiornato_da'],
  giornate: ['id', 'progetto_id', 'data', 'etichetta', 'ordine', 'eliminato', 'creato_il', 'aggiornato_il',
    'aggiornato_da', 'versione', 'note'],
  // rubrica comune a tutte le produzioni
  persone: ['id', 'nome', 'ruolo', 'telefono', 'email', 'azienda', 'note', 'eliminato', 'creato_il', 'creato_da',
    'aggiornato_il', 'aggiornato_da', 'versione'],
  squadra: ['id', 'progetto_id', 'persona_id', 'ruolo', 'giornata_id', 'spazio_id', 'note', 'ordine', 'eliminato',
    'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  // documenti operativi di una produzione (Production Plan, Material List): JSON spezzato in parti
  documenti: ['id', 'progetto_id', 'tipo', 'versione', 'parti', 'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'eliminato'],
  documenti_parti: ['id', 'documento_id', 'n', 'testo'],
  utenti: ['id', 'email', 'nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo', 'creato_il',
    'aggiornato_il', 'versione', 'ultimo_accesso'],
  sessioni: ['hash', 'email', 'creata', 'scade', 'ultimo_uso', 'dispositivo'],
  condivisioni: ['id', 'hash', 'eventi', 'sezioni', 'mostra_contatti', 'scade', 'revocato', 'creato_da',
    'creato_il', 'ultimo_accesso', 'etichetta'],
  storico: ['ts', 'email', 'evento_id', 'sezione', 'azione', 'rif_id', 'prima', 'dopo'],
  config: ['chiave', 'valore', 'aggiornato_il']
};

// OWNER è solo l'email in ADMIN_EMAIL e non si assegna dal portale.
var RUOLI = ['OWNER', 'PRODUCTION', 'VIEWER'];
var RUOLI_ASSEGNABILI = ['PRODUCTION', 'VIEWER'];
var STATI_EVENTO = ['attivo', 'annullato', 'archiviato'];

var LISTE_DEFAULT = {
  aree: ['Audio', 'Luci', 'Video', 'Backline', 'Rigging', 'Venue', 'Altro'],
  provenienze: ['CoolClub', 'Da noleggiare', 'Fornito da terzi', 'Da altro magazzino', 'Da verificare']
};

// ===== 03_Db.js =====
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
    removeRow: removeRow, clearCache: clearCache, withLock: withLock
  };
})();

// ===== 04_Storico.js =====
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

// ===== 10_Auth.js =====
/**
 * CTRL · Accesso con codice via email e sessioni.
 *
 * - Il codice (6 cifre) vale 10 minuti, massimo 5 tentativi.
 * - Massimo 1 codice al minuto e 5 all'ora per indirizzo.
 * - La risposta a "invia codice" è identica anche se l'email non è autorizzata,
 *   così non si può scoprire chi ha accesso.
 * - Nel foglio si salva solo l'impronta (hash) del token di sessione.
 */
var Auth = (function () {
  var CODE_TTL_MIN = 10;
  var CODE_MAX_TRIES = 5;
  var SESSION_DAYS = 30;
  var TOUCH_EVERY_MIN = 60;

  function cache() { return CacheService.getScriptCache(); }

  function key(prefix, email) { return prefix + Util.sha256(email).slice(0, 40); }

  function requestCode(payload) {
    var email = Util.normEmail(payload && payload.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');

    var c = cache();
    var last = c.get(key('otpw_', email));
    if (last) throw new CtrlError('RATE_LIMIT', 'Attendi un minuto prima di chiedere un nuovo codice.');
    var count = parseInt(c.get(key('otpc_', email)) || '0', 10);
    if (count >= 5) throw new CtrlError('RATE_LIMIT', 'Troppi codici richiesti. Riprova tra un\'ora.');
    c.put(key('otpw_', email), '1', 60);
    c.put(key('otpc_', email), String(count + 1), 3600);

    var user = Users.byEmail(email);
    if (user && Util.bool(user.attivo)) {
      var code = Util.newCode();
      var record = { h: Util.sha256(email + ':' + code), exp: Date.now() + CODE_TTL_MIN * 60000, tries: 0 };
      c.put(key('otp_', email), JSON.stringify(record), CODE_TTL_MIN * 60);
      MailApp.sendEmail({
        to: email,
        subject: 'CTRL · codice di accesso ' + code,
        body: 'Il tuo codice di accesso a CTRL è: ' + code + '\n\nVale ' + CODE_TTL_MIN +
          ' minuti. Se non l\'hai richiesto tu, ignora questa email.',
        name: 'CTRL'
      });
    }
    return { inviato: true, minuti: CODE_TTL_MIN };
  }

  function verifyCode(payload) {
    var email = Util.normEmail(payload && payload.email);
    var code = String((payload && payload.code) || '').replace(/\D/g, '');
    if (!Util.isEmail(email) || code.length !== 6) throw new CtrlError('INVALID', 'Codice non valido');

    var c = cache();
    var k = key('otp_', email);
    var raw = c.get(k);
    if (!raw) throw new CtrlError('CODE_EXPIRED', 'Codice scaduto o non richiesto. Chiedine uno nuovo.');
    var rec = JSON.parse(raw);
    if (Date.now() > rec.exp) { c.remove(k); throw new CtrlError('CODE_EXPIRED', 'Codice scaduto. Chiedine uno nuovo.'); }
    if (rec.h !== Util.sha256(email + ':' + code)) {
      rec.tries++;
      if (rec.tries >= CODE_MAX_TRIES) {
        c.remove(k);
        throw new CtrlError('CODE_EXPIRED', 'Troppi tentativi. Chiedi un nuovo codice.');
      }
      c.put(k, JSON.stringify(rec), Math.max(1, Math.round((rec.exp - Date.now()) / 1000)));
      throw new CtrlError('CODE_WRONG', 'Codice errato. Tentativi rimasti: ' + (CODE_MAX_TRIES - rec.tries));
    }
    c.remove(k);

    var user = Users.byEmail(email);
    if (!user || !Util.bool(user.attivo)) throw new CtrlError('FORBIDDEN', 'Accesso non autorizzato');

    return Db.withLock(function () {
      var token = Util.newToken();
      var now = Util.nowIso();
      var exp = new Date(Date.now() + SESSION_DAYS * 86400000);
      Db.insert('sessioni', {
        hash: Util.sha256(token), email: email, creata: now,
        scade: Utilities.formatDate(exp, CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss"), ultimo_uso: now,
        dispositivo: Util.text(payload.dispositivo, 120)
      });
      Users.touchLogin(email);
      return { token: token, utente: Users.publicProfile(Users.byEmail(email)) };
    });
  }

  /** Utente della richiesta, o errore AUTH_REQUIRED. */
  function current(token) {
    if (!token || typeof token !== 'string' || token.length < 32) throw new CtrlError('AUTH_REQUIRED', 'Accedi per continuare');
    var h = Util.sha256(token);
    var s = Db.find('sessioni', 'hash', h);
    if (!s) throw new CtrlError('AUTH_REQUIRED', 'Sessione non valida. Accedi di nuovo.');
    if (s.scade < Util.nowIso()) throw new CtrlError('AUTH_REQUIRED', 'Sessione scaduta. Accedi di nuovo.');
    var user = Users.byEmail(s.email);
    if (!user || !Util.bool(user.attivo)) throw new CtrlError('AUTH_REQUIRED', 'Accesso revocato');
    var touchLimit = Utilities.formatDate(new Date(Date.now() - TOUCH_EVERY_MIN * 60000), CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss");
    if (s.ultimo_uso < touchLimit) {
      try {
        Db.withLock(function () { Db.update('sessioni', 'hash', h, { ultimo_uso: Util.nowIso() }); });
      } catch (e) { /* non bloccante */ }
    }
    return user;
  }

  function logout(token) {
    if (!token) return { ok: true };
    var h = Util.sha256(token);
    Db.withLock(function () { Db.removeRow('sessioni', 'hash', h); });
    return { ok: true };
  }

  /** Chiude tutte le sessioni di un utente (disattivazione, cambio ruolo). */
  function revokeAll(email) {
    var rows = Db.all('sessioni').filter(function (s) { return s.email === email; });
    rows.forEach(function (s) { Db.removeRow('sessioni', 'hash', s.hash); });
    return rows.length;
  }

  /** Pulizia periodica delle sessioni scadute. */
  function purgeExpired() {
    var now = Util.nowIso();
    var n = 0;
    Db.withLock(function () {
      Db.all('sessioni').filter(function (s) { return s.scade < now; }).forEach(function (s) {
        Db.removeRow('sessioni', 'hash', s.hash); n++;
      });
    });
    return n;
  }

  return { requestCode: requestCode, verifyCode: verifyCode, current: current, logout: logout, revokeAll: revokeAll, purgeExpired: purgeExpired };
})();

// ===== 11_Users.js =====
/**
 * CTRL · Utenti e permessi.
 *
 * Ruoli:
 * - OWNER: tutto. È solo l'email in ADMIN_EMAIL (proprietà dello script) e resta tale anche se il foglio viene modificato.
 *   Non si assegna dal portale: nessun altro può diventarlo.
 * - PRODUCTION: vede tutto, scarica i PDF, carica file, crea e modifica Production Plan e Material List.
 * - VIEWER: vede e scarica, non modifica nulla.
 * I valori vecchi nel foglio (ADMIN, COLLABORATORE, LETTURA) vengono letti come i nuovi: ADMIN diverso dal proprietario
 * vale PRODUCTION, COLLABORATORE con puo_modificare vale PRODUCTION, gli altri VIEWER. Il setup li riscrive.
 */
var Users = (function () {
  function adminEmail() { return Util.normEmail(Config.get('ADMIN_EMAIL', '')); }

  /** Ruolo effettivo di una riga utente: il proprietario è sempre OWNER, nessun altro lo è mai. */
  function ruoloDi(u) {
    if (!u) return 'VIEWER';
    if (Util.normEmail(u.email) === adminEmail()) return 'OWNER';
    var r = String(u.ruolo || '').toUpperCase();
    if (r === 'PRODUCTION' || r === 'VIEWER') return r;
    if (r === 'ADMIN') return 'PRODUCTION';
    if (r === 'COLLABORATORE') return Util.bool(u.puo_modificare) ? 'PRODUCTION' : 'VIEWER';
    return 'VIEWER';
  }

  function byEmail(email) {
    var e = Util.normEmail(email);
    var u = Db.find('utenti', 'email', e);
    if (!u && e && e === adminEmail()) {
      return { id: 'usr_admin', email: e, nome: 'Owner', ruolo: 'OWNER', attivo: 'TRUE' };
    }
    if (u) {
      u = JSON.parse(JSON.stringify(u));
      u.ruolo = ruoloDi(u);
      if (e === adminEmail()) u.attivo = 'TRUE';
    }
    return u;
  }

  function perms(u) {
    var admin = u.ruolo === 'OWNER';
    var prod = u.ruolo === 'PRODUCTION';
    return {
      admin: admin,
      vedere: true,
      caricare: admin || prod,
      modificare: admin || prod,
      creareEventi: admin,
      condividere: admin,
      cestinare: admin,
      impostazioni: admin
    };
  }

  function can(u, what) {
    var p = perms(u);
    if (!(what in p)) throw new CtrlError('SERVER', 'Permesso sconosciuto: ' + what);
    return !!p[what];
  }

  function require_(u, what) {
    if (!can(u, what)) throw new CtrlError('FORBIDDEN', 'Non hai i permessi per questa operazione');
  }

  function publicProfile(u) {
    return { email: u.email, nome: u.nome || u.email, ruolo: u.ruolo, permessi: perms(u) };
  }

  function touchLogin(email) {
    var u = Db.find('utenti', 'email', email);
    if (u) Db.update('utenti', 'email', email, { ultimo_accesso: Util.nowIso() });
  }

  function list(actor) {
    require_(actor, 'impostazioni');
    return Db.all('utenti').map(function (u) {
      return {
        id: u.id, email: u.email, nome: u.nome, ruolo: ruoloDi(u),
        attivo: Util.bool(u.attivo) || u.email === adminEmail(), ultimo_accesso: u.ultimo_accesso, versione: u.versione,
        protetto: u.email === adminEmail()
      };
    }).sort(function (a, b) { return a.email < b.email ? -1 : 1; });
  }

  /** Crea o aggiorna un utente. */
  function save(actor, p) {
    require_(actor, 'impostazioni');
    var email = Util.normEmail(p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    var ruolo = String(p.ruolo || '').toUpperCase();
    var isAdminMail = email === adminEmail();
    if (isAdminMail) {
      if (ruolo !== 'OWNER' || p.attivo === false) throw new CtrlError('INVALID', 'Il proprietario non può essere declassato o disattivato');
    } else if (ruolo === 'OWNER') {
      throw new CtrlError('INVALID', 'Il ruolo OWNER è riservato al proprietario di CTRL');
    } else if (RUOLI_ASSEGNABILI.indexOf(ruolo) < 0) {
      throw new CtrlError('INVALID', 'Ruolo non valido');
    }
    var fields = {
      email: email,
      nome: Util.text(p.nome, 80),
      ruolo: ruolo,
      puo_caricare: ruolo === 'VIEWER' ? 'FALSE' : 'TRUE',
      puo_modificare: ruolo === 'VIEWER' ? 'FALSE' : 'TRUE',
      attivo: p.attivo === false ? 'FALSE' : 'TRUE',
      aggiornato_il: Util.nowIso()
    };
    return Db.withLock(function () {
      var existing = Db.find('utenti', 'email', email);
      var out;
      if (existing) {
        var before = JSON.parse(JSON.stringify(existing));
        out = Db.update('utenti', 'email', email, fields, p.versione);
        var d = Storico.diff(before, out, ['nome', 'ruolo', 'attivo']);
        if (d.changed) Storico.log(actor.email, '', 'utenti', 'modifica', email, d.prima, d.dopo);
        var lostAccess = before.attivo !== out.attivo && out.attivo === 'FALSE';
        var demoted = ruoloDi(before) !== ruoloDi(out);
        if (lostAccess || demoted) Auth.revokeAll(email);
      } else {
        fields.id = Util.newId('usr');
        fields.creato_il = Util.nowIso();
        fields.versione = '1';
        out = Db.insert('utenti', fields);
        Storico.log(actor.email, '', 'utenti', 'crea', email, '', { ruolo: ruolo });
      }
      return { email: out.email, versione: out.versione };
    });
  }

  return {
    byEmail: byEmail, ruoloDi: ruoloDi, perms: perms, can: can, require: require_, publicProfile: publicProfile,
    touchLogin: touchLogin, list: list, save: save, adminEmail: adminEmail
  };
})();

// ===== 12_Settings.js =====
/**
 * CTRL · Impostazioni modificabili dall'admin (liste a tendina, stato sincronizzazione).
 */
var Settings = (function () {
  var LISTE = ['aree', 'provenienze'];

  function getRaw(chiave) {
    var r = Db.find('config', 'chiave', chiave);
    return r ? r.valore : '';
  }

  function setRaw(chiave, valore) {
    var r = Db.find('config', 'chiave', chiave);
    var v = typeof valore === 'string' ? valore : JSON.stringify(valore);
    if (r) Db.update('config', 'chiave', chiave, { valore: v, aggiornato_il: Util.nowIso() });
    else Db.insert('config', { chiave: chiave, valore: v, aggiornato_il: Util.nowIso() });
  }

  function lista(nome) {
    var raw = getRaw('lista_' + nome);
    if (!raw) return LISTE_DEFAULT[nome].slice();
    try { return JSON.parse(raw); } catch (e) { return LISTE_DEFAULT[nome].slice(); }
  }

  function get() {
    return {
      liste: { aree: lista('aree'), provenienze: lista('provenienze') },
      sync: { ultimo: getRaw('sync_ultimo'), esito: getRaw('sync_esito') },
      ambiente: Config.get('ENV', 'prod'),
      versione: CTRL_VERSION
    };
  }

  function saveList(actor, p) {
    Users.require(actor, 'impostazioni');
    var nome = String(p.lista || '');
    if (LISTE.indexOf(nome) < 0) throw new CtrlError('INVALID', 'Lista sconosciuta');
    if (!Array.isArray(p.valori)) throw new CtrlError('INVALID', 'Valori non validi');
    var seen = {};
    var valori = [];
    p.valori.forEach(function (v) {
      var t = Util.text(v, 60);
      var k = t.toLowerCase();
      if (t && !seen[k]) { seen[k] = true; valori.push(t); }
    });
    if (!valori.length) throw new CtrlError('INVALID', 'La lista deve avere almeno un valore');
    if (valori.length > 50) throw new CtrlError('INVALID', 'Massimo 50 valori');
    return Db.withLock(function () {
      var prima = lista(nome);
      setRaw('lista_' + nome, valori);
      Storico.log(actor.email, '', 'impostazioni', 'lista_' + nome, '', prima, valori);
      return { lista: nome, valori: valori };
    });
  }

  return { get: get, lista: lista, saveList: saveList, getRaw: getRaw, setRaw: setRaw };
})();

// ===== 20_Events.js =====
/**
 * CTRL · Eventi.
 *
 * - origine "calendar": titolo, date, orari, luogo, descrizione e colore arrivano dal
 *   Google Calendar e si modificano lì. In CTRL si aggiungono note e contenuti di produzione.
 * - origine "manuale": creati dall'admin, tutti i campi modificabili in CTRL.
 */
var Events = (function () {
  var CAL_FIELDS = ['titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo', 'descrizione', 'colore'];
  var COLORE_DEFAULT = '#5b6472';

  /** Per ogni evento: presenza di contenuti in piano, materiale, scheda (oggi: file allegati). */
  function contaSezioni() {
    var out = {};
    Db.all('allegati').forEach(function (r) {
      if (Util.bool(r.nel_cestino) || Allegati.SEZIONI.indexOf(r.sezione) < 0) return;
      if (!out[r.evento_id]) out[r.evento_id] = { piano: 0, materiale: 0, scheda: 0 };
      out[r.evento_id][r.sezione]++;
    });
    return out;
  }

  function view(e, conteggi, user) {
    var c = conteggi[e.id] || { piano: 0, materiale: 0, scheda: 0 };
    var v = {
      id: e.id, origine: e.origine, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data,
      ora_inizio: e.ora_inizio, ora_fine: e.ora_fine, luogo: e.luogo, descrizione: e.descrizione,
      colore: e.colore || COLORE_DEFAULT, stato: e.stato, note: e.note, versione: e.versione,
      aggiornato_il: e.aggiornato_il, aggiornato_da: e.aggiornato_da, produzione_id: e.progetto_id || '',
      stato_doc: { piano: c.piano > 0, materiale: c.materiale > 0, scheda: c.scheda > 0 }
    };
    if (user && Users.can(user, 'admin') && e.cartella_id) v.cartella_url = 'https://drive.google.com/drive/folders/' + e.cartella_id;
    return v;
  }

  function list(user, p) {
    var conteggi = contaSezioni();
    var includiArchiviati = !!(p && p.archiviati);
    return Db.all('eventi')
      .filter(function (e) { return includiArchiviati || e.stato !== 'archiviato'; })
      .map(function (e) { return view(e, conteggi, user); })
      .sort(function (a, b) {
        var ka = a.data + (a.ora_inizio || '99:99') + a.titolo;
        var kb = b.data + (b.ora_inizio || '99:99') + b.titolo;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
  }

  function get(user, p) {
    var e = Db.find('eventi', 'id', p && p.id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var out = view(e, contaSezioni(), user);
    out.allegati = Allegati.perEvento(e.id);
    out.produzione = e.progetto_id ? Produzioni.riepilogo(e.progetto_id) : null;
    if (Users.can(user, 'admin')) out.storico = Storico.forEvent(e.id, 30);
    return out;
  }

  function validateFields(p, partial) {
    var f = {};
    if (!partial || 'titolo' in p) {
      f.titolo = Util.text(p.titolo, 200);
      if (!f.titolo) throw new CtrlError('INVALID', 'Il titolo è obbligatorio');
    }
    if (!partial || 'data' in p) {
      if (!Util.isDate(p.data)) throw new CtrlError('INVALID', 'Data non valida');
      f.data = p.data;
    }
    if (!partial || 'data_fine' in p) {
      var df = p.data_fine || p.data || '';
      if (df && !Util.isDate(df)) throw new CtrlError('INVALID', 'Data di fine non valida');
      f.data_fine = df;
    }
    ['ora_inizio', 'ora_fine'].forEach(function (k) {
      if (!partial || k in p) {
        var t = p[k] || '';
        if (t && !Util.isTime(t)) throw new CtrlError('INVALID', 'Orario non valido');
        f[k] = t;
      }
    });
    if (!partial || 'luogo' in p) f.luogo = Util.text(p.luogo, 200);
    if (!partial || 'descrizione' in p) f.descrizione = Util.text(p.descrizione, 5000);
    if (!partial || 'colore' in p) {
      var col = p.colore || COLORE_DEFAULT;
      if (!Util.isColor(col)) throw new CtrlError('INVALID', 'Colore non valido');
      f.colore = col.toLowerCase();
    }
    return f;
  }

  function create(user, p) {
    Users.require(user, 'creareEventi');
    var f = validateFields(p || {}, false);
    if (f.data_fine && f.data_fine < f.data) throw new CtrlError('INVALID', 'La data di fine precede quella di inizio');
    return Db.withLock(function () {
      var now = Util.nowIso();
      f.id = Util.newId('ev');
      f.origine = 'manuale';
      f.stato = 'attivo';
      f.note = '';
      f.creato_il = now; f.creato_da = user.email;
      f.aggiornato_il = now; f.aggiornato_da = user.email;
      f.versione = '1';
      var row = Db.insert('eventi', f);
      Storico.log(user.email, row.id, 'evento', 'crea', row.id, '', { titolo: row.titolo, data: row.data });
      return get(user, { id: row.id });
    });
  }

  function update(user, p) {
    if (!p || !p.id) throw new CtrlError('INVALID', 'Evento mancante');
    var e = Db.find('eventi', 'id', p.id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var patch = {};
    var fieldsChanged = Object.keys(p).filter(function (k) { return CAL_FIELDS.indexOf(k) >= 0; });
    if (fieldsChanged.length) {
      Users.require(user, 'creareEventi');
      if (e.origine === 'calendar') throw new CtrlError('INVALID', 'Questo evento arriva dal Google Calendar: modificalo lì');
      var f = validateFields(p, true);
      Object.keys(f).forEach(function (k) { patch[k] = f[k]; });
    }
    if ('note' in p) {
      Users.require(user, 'modificare');
      patch.note = Util.text(p.note, 5000);
    }
    if (!Object.keys(patch).length) throw new CtrlError('INVALID', 'Nessuna modifica');
    var nextData = patch.data || e.data;
    var nextFine = 'data_fine' in patch ? patch.data_fine : e.data_fine;
    if (nextFine && nextFine < nextData) throw new CtrlError('INVALID', 'La data di fine precede quella di inizio');
    patch.aggiornato_il = Util.nowIso();
    patch.aggiornato_da = user.email;
    return Db.withLock(function () {
      var before = JSON.parse(JSON.stringify(Db.find('eventi', 'id', p.id)));
      var row = Db.update('eventi', 'id', p.id, patch, p.versione);
      var d = Storico.diff(before, row, CAL_FIELDS.concat(['note']));
      if (d.changed) Storico.log(user.email, row.id, 'evento', 'modifica', row.id, d.prima, d.dopo);
      return get(user, { id: row.id });
    });
  }

  function setStato(user, p) {
    Users.require(user, 'cestinare');
    var stato = String(p && p.stato || '');
    if (STATI_EVENTO.indexOf(stato) < 0) throw new CtrlError('INVALID', 'Stato non valido');
    return Db.withLock(function () {
      var e = Db.find('eventi', 'id', p.id);
      if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
      var prima = e.stato;
      var row = Db.update('eventi', 'id', p.id, { stato: stato, aggiornato_il: Util.nowIso(), aggiornato_da: user.email }, p.versione);
      Storico.log(user.email, row.id, 'evento', 'stato', row.id, prima, stato);
      return get(user, { id: row.id });
    });
  }

  return { list: list, get: get, create: create, update: update, setStato: setStato, CAL_FIELDS: CAL_FIELDS, COLORE_DEFAULT: COLORE_DEFAULT };
})();

// ===== 21_CalendarSync.js =====
/**
 * CTRL · Sincronizzazione dal Google Calendar (solo lettura del calendario).
 *
 * Finestra: da 30 giorni fa a 365 giorni avanti.
 * - evento nuovo        → creato in CTRL (origine "calendar")
 * - evento cambiato     → aggiornati titolo, date, orari, luogo, descrizione, colore
 * - evento sparito      → stato "annullato" (piano e materiale restano)
 * - evento ricomparso   → di nuovo "attivo"
 * - eventi "archiviati" e manuali non vengono mai toccati.
 */
var CalendarSync = (function () {
  var PAST_DAYS = 30;
  var FUTURE_DAYS = 365;

  // Colori evento di Google Calendar (EventColor 1-11). Fonte: palette standard del Calendar.
  var EVENT_COLORS = {
    '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
    '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
  };

  function keyOf(ev) {
    var id = ev.getId();
    if (ev.isRecurringEvent && ev.isRecurringEvent()) {
      var start = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
      return id + '@' + Util.fmtDate(start);
    }
    return id;
  }

  function fieldsOf(ev, calColor) {
    var f = {};
    f.titolo = Util.text(ev.getTitle(), 200) || '(senza titolo)';
    if (ev.isAllDayEvent()) {
      f.data = Util.fmtDate(ev.getAllDayStartDate());
      var endEx = Util.fmtDate(ev.getAllDayEndDate());
      var last = Util.addDays(endEx, -1);
      f.data_fine = last < f.data ? f.data : last;
      f.ora_inizio = '';
      f.ora_fine = '';
    } else {
      var s = ev.getStartTime(), e = ev.getEndTime();
      f.data = Util.fmtDate(s);
      f.ora_inizio = Util.fmtTime(s);
      f.ora_fine = Util.fmtTime(e);
      var endDay = Util.fmtDate(e);
      if (f.ora_fine === '00:00' && endDay > f.data) endDay = Util.addDays(endDay, -1);
      f.data_fine = endDay < f.data ? f.data : endDay;
    }
    f.luogo = Util.text(ev.getLocation(), 200);
    f.descrizione = Util.text(Util.stripHtml(ev.getDescription()), 5000);
    var c = String(ev.getColor() || '');
    f.colore = (EVENT_COLORS[c] || (Util.isColor(calColor) ? calColor : Events.COLORE_DEFAULT)).toLowerCase();
    return f;
  }

  function run(actorEmail) {
    var calId = Config.require('CALENDAR_ID');
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) throw new CtrlError('SERVER', 'Calendario non raggiungibile: controlla CALENDAR_ID e i permessi.');
    var calColor = String(cal.getColor() || '');
    var now = new Date();
    var from = new Date(now.getTime() - PAST_DAYS * 86400000);
    var to = new Date(now.getTime() + FUTURE_DAYS * 86400000);
    var fromIso = Util.fmtDate(from), toIso = Util.fmtDate(to);
    var events = cal.getEvents(from, to);

    return Db.withLock(function () {
      var stamp = Util.nowIso();
      var byKey = {};
      Db.all('eventi').forEach(function (r) { if (r.origine === 'calendar' && r.cal_key) byKey[r.cal_key] = r; });
      var seen = {};
      var res = { creati: 0, aggiornati: 0, annullati: 0, riattivati: 0, letti: events.length };

      events.forEach(function (ev) {
        var key = keyOf(ev);
        if (seen[key]) return;
        seen[key] = true;
        var f = fieldsOf(ev, calColor);
        var row = byKey[key];
        if (!row) {
          f.id = Util.newId('ev');
          f.origine = 'calendar';
          f.cal_key = key;
          f.stato = 'attivo';
          f.note = '';
          f.creato_il = stamp; f.creato_da = 'calendar';
          f.aggiornato_il = stamp; f.aggiornato_da = 'calendar';
          f.versione = '1';
          f.sync_il = stamp;
          Db.insert('eventi', f);
          res.creati++;
          return;
        }
        var patch = {};
        Events.CAL_FIELDS.forEach(function (k) { if ((row[k] || '') !== (f[k] || '')) patch[k] = f[k]; });
        var reactivate = row.stato === 'annullato';
        if (reactivate) patch.stato = 'attivo';
        if (Object.keys(patch).length) {
          var before = JSON.parse(JSON.stringify(row));
          patch.aggiornato_il = stamp; patch.aggiornato_da = 'calendar'; patch.sync_il = stamp;
          var after = Db.update('eventi', 'id', row.id, patch);
          var d = Storico.diff(before, after, Events.CAL_FIELDS.concat(['stato']));
          if (d.changed) Storico.log('calendar', row.id, 'evento', reactivate ? 'riattivato' : 'sync', row.id, d.prima, d.dopo);
          if (reactivate) res.riattivati++; else res.aggiornati++;
        }
      });

      Object.keys(byKey).forEach(function (key) {
        var row = byKey[key];
        if (seen[key] || row.stato !== 'attivo') return;
        // Solo eventi che cadono nella finestra letta: quelli più vecchi restano come sono.
        if (row.data < fromIso || row.data > toIso) return;
        Db.update('eventi', 'id', row.id, { stato: 'annullato', aggiornato_il: stamp, aggiornato_da: 'calendar', sync_il: stamp });
        Storico.log('calendar', row.id, 'evento', 'annullato', row.id, 'attivo', 'annullato');
        res.annullati++;
      });

      Settings.setRaw('sync_ultimo', stamp);
      Settings.setRaw('sync_esito', res);
      if (actorEmail) Storico.log(actorEmail, '', 'sync', 'manuale', '', '', res);
      return res;
    });
  }

  return { run: run, EVENT_COLORS: EVENT_COLORS };
})();

// ===== 22_Allegati.js =====
/**
 * CTRL · File allegati a un evento (rider, PdP già pronti, foto), salvati su Drive
 * nella cartella dell'evento e raggruppati per sezione: piano, materiale, scheda.
 *
 * Righe e testo libero della Fase 2 sono stati sostituiti dalla scheda di produzione
 * (23_Produzioni.js); restano solo i file.
 */
var Allegati = (function () {
  var SEZIONI = ['piano', 'materiale', 'scheda'];
  var MAX_BYTE = 20 * 1024 * 1024; // limite prudente per Apps Script (corpo della richiesta in base64)

  function sezione(s) {
    if (SEZIONI.indexOf(s) < 0) throw new CtrlError('INVALID', 'Sezione sconosciuta');
    return s;
  }

  function evento(id) {
    var e = Db.find('eventi', 'id', id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  function lista(eventoId, sez) {
    return Db.all('allegati')
      .filter(function (r) { return r.evento_id === eventoId && r.sezione === sez && !Util.bool(r.nel_cestino); })
      .sort(function (a, b) { return a.caricato_il < b.caricato_il ? -1 : 1; })
      .map(function (r) {
        return { id: r.id, nome: r.nome, mime: r.mime, byte: parseInt(r.byte, 10) || 0, caricato_da: r.caricato_da, caricato_il: r.caricato_il };
      });
  }

  /** File dell'evento per sezione (inclusi nella risposta di eventi.get). */
  function perEvento(eventoId) {
    var out = {};
    SEZIONI.forEach(function (s) { out[s] = lista(eventoId, s); });
    return out;
  }

  function nomeCartella(e) {
    var t = String(e.titolo || 'Evento').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return e.data + ' · ' + t;
  }

  /** Cartella Drive dell'evento, creata al primo caricamento. Da chiamare dentro Db.withLock. */
  function cartella(e) {
    if (e.cartella_id) {
      try { return DriveApp.getFolderById(e.cartella_id); } catch (err) { /* cartella rimossa: se ne crea una nuova */ }
    }
    var padre = DriveApp.getFolderById(Config.require('EVENTI_ID'));
    var f = padre.createFolder(nomeCartella(e));
    Db.update('eventi', 'id', e.id, { cartella_id: f.getId() }, null, true);
    return f;
  }

  function carica(user, p) {
    Users.require(user, 'caricare');
    p = p || {};
    sezione(p.sezione);
    var nome = Util.text(p.nome, 150).replace(/[\\/]+/g, '-');
    if (!nome) throw new CtrlError('INVALID', 'Nome del file mancante');
    if (typeof p.dati !== 'string' || !p.dati) throw new CtrlError('INVALID', 'File vuoto');
    if (p.dati.length > Math.ceil(MAX_BYTE / 3) * 4 + 4) throw new CtrlError('TOO_LARGE', 'File troppo grande (massimo 20 MB)');
    var mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(p.mime || '')) ? String(p.mime) : 'application/octet-stream';
    var bytes;
    try { bytes = Utilities.base64Decode(p.dati); } catch (err) { throw new CtrlError('INVALID', 'File non leggibile'); }
    if (!bytes.length) throw new CtrlError('INVALID', 'File vuoto');
    if (bytes.length > MAX_BYTE) throw new CtrlError('TOO_LARGE', 'File troppo grande (massimo 20 MB)');

    return Db.withLock(function () {
      var e = evento(p.evento_id);
      var file = cartella(e).createFile(Utilities.newBlob(bytes, mime, nome));
      var row = Db.insert('allegati', {
        id: Util.newId('al'), evento_id: e.id, sezione: p.sezione, drive_id: file.getId(), nome: nome, mime: mime,
        byte: String(bytes.length), caricato_da: user.email, caricato_il: Util.nowIso(), nel_cestino: 'FALSE'
      });
      Storico.log(user.email, e.id, p.sezione, 'allegato', row.id, '', nome);
      return { sezione: p.sezione, allegati: lista(e.id, p.sezione) };
    });
  }

  function trovaAllegato(id) {
    var a = Db.find('allegati', 'id', id);
    if (!a || Util.bool(a.nel_cestino)) throw new CtrlError('NOT_FOUND', 'File non trovato');
    return a;
  }

  function scarica(user, p) {
    var a = trovaAllegato(p && p.id);
    var file;
    try { file = DriveApp.getFileById(a.drive_id); } catch (err) { throw new CtrlError('NOT_FOUND', 'Il file non è più su Drive'); }
    if (file.isTrashed && file.isTrashed()) throw new CtrlError('NOT_FOUND', 'Il file è nel cestino di Drive');
    return { nome: a.nome, mime: a.mime, dati: Utilities.base64Encode(file.getBlob().getBytes()) };
  }

  /** Sposta il file nel cestino di Drive (recuperabile per 30 giorni). Admin o chi l'ha caricato. */
  function elimina(user, p) {
    Users.require(user, 'caricare');
    return Db.withLock(function () {
      var a = trovaAllegato(p && p.id);
      if (!Users.can(user, 'admin') && a.caricato_da !== user.email) {
        throw new CtrlError('FORBIDDEN', 'Puoi togliere solo i file che hai caricato tu');
      }
      try { DriveApp.getFileById(a.drive_id).setTrashed(true); } catch (err) { /* già rimosso da Drive */ }
      Db.update('allegati', 'id', a.id, { nel_cestino: 'TRUE' });
      Storico.log(user.email, a.evento_id, a.sezione, 'allegato_tolto', a.id, a.nome, '');
      return { sezione: a.sezione, allegati: lista(a.evento_id, a.sezione) };
    });
  }

  /**
   * PDF generato da CTRL (Production Plan / Material List): sostituisce quello precedente dello stesso tipo
   * nella sezione dell'evento. Il vecchio finisce nel cestino di Drive (recuperabile 30 giorni).
   * Da chiamare dentro Db.withLock.
   */
  function sostituisciPdf(user, e, sez, prefisso, nome, bytes) {
    sezione(sez);
    Db.all('allegati').forEach(function (r) {
      if (r.evento_id !== e.id || r.sezione !== sez || Util.bool(r.nel_cestino)) return;
      if (r.mime !== 'application/pdf' || String(r.nome).indexOf(prefisso) !== 0) return;
      try { DriveApp.getFileById(r.drive_id).setTrashed(true); } catch (err) { /* già rimosso da Drive */ }
      Db.update('allegati', 'id', r.id, { nel_cestino: 'TRUE' });
      Storico.log(user.email, e.id, sez, 'allegato_sostituito', r.id, r.nome, nome);
    });
    var file = cartella(e).createFile(Utilities.newBlob(bytes, 'application/pdf', nome));
    var row = Db.insert('allegati', {
      id: Util.newId('al'), evento_id: e.id, sezione: sez, drive_id: file.getId(), nome: nome, mime: 'application/pdf',
      byte: String(bytes.length), caricato_da: user.email, caricato_il: Util.nowIso(), nel_cestino: 'FALSE'
    });
    Storico.log(user.email, e.id, sez, 'allegato', row.id, '', nome);
    return row;
  }

  return { SEZIONI: SEZIONI, MAX_BYTE: MAX_BYTE, perEvento: perEvento, carica: carica, scarica: scarica, elimina: elimina,
    sostituisciPdf: sostituisciPdf };
})();

// ===== 23_Produzioni.js =====
/**
 * CTRL · Produzione = contenitore dei documenti operativi (Production Plan e Material List).
 *
 * Una produzione (tabella "progetti") raggruppa uno o più eventi del Calendar (eventi.progetto_id):
 * un concerto ha un evento, un festival ne ha molti che condividono gli stessi documenti.
 * Si crea da sola la prima volta che si apre un documento (assicura).
 */
var Produzioni = (function () {
  function vivo(r) { return r && !Util.bool(r.eliminato); }
  function trova(id) {
    var r = Db.find('progetti', 'id', String(id || ''));
    return vivo(r) ? r : null;
  }
  function evento(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }
  function eventiDi(pid) {
    return Db.all('eventi').filter(function (e) { return e.progetto_id === pid; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
  }

  function aggiornaDate(pid) {
    var ev = eventiDi(pid);
    var patch = { data: ev.length ? ev[0].data : '', data_fine: ev.reduce(function (m, e) { var f = e.data_fine || e.data; return f > m ? f : m; }, '') };
    var p = trova(pid);
    if (patch.data !== (p.data || '') || patch.data_fine !== (p.data_fine || '')) Db.update('progetti', 'id', pid, patch, null, true);
  }

  /** Riepilogo per il dettaglio evento: eventi della produzione e documenti già scritti. */
  function riepilogo(pid) {
    var p = trova(pid);
    if (!p) return null;
    return {
      id: p.id, nome: p.nome, tipo: p.tipo || 'evento',
      eventi: eventiDi(pid).map(function (e) { return { id: e.id, titolo: e.titolo, data: e.data }; }),
      documenti: Documenti.riepilogo(pid)
    };
  }

  /** Restituisce la produzione di un evento, creandola se manca. */
  function assicura(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var e = evento(p && p.evento_id);
      if (trova(e.progetto_id)) return riepilogo(e.progetto_id);
      var now = Util.nowIso(), pid = Util.newId('pr');
      Db.insert('progetti', { id: pid, nome: Util.text(e.titolo, 120) || 'Produzione', tipo: 'evento', stato: 'attivo',
        creato_il: now, creato_da: user.email, aggiornato_il: now, aggiornato_da: user.email, versione: '1', eliminato: 'FALSE', note: '' });
      Db.update('eventi', 'id', e.id, { progetto_id: pid }, null, true);
      aggiornaDate(pid);
      Storico.log(user.email, e.id, 'produzione', 'crea', pid, '', { nome: e.titolo });
      return riepilogo(pid);
    });
  }

  /** Mette un altro evento nella stessa produzione (festival): condivide Plan e Material List. */
  function collega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pr = trova(p && p.id);
      if (!pr) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
      var e = evento(p && p.evento_id);
      if (e.progetto_id === pr.id) return riepilogo(pr.id);
      if (trova(e.progetto_id)) throw new CtrlError('INVALID', 'Questo evento fa già parte di un\'altra scheda di produzione');
      Db.update('eventi', 'id', e.id, { progetto_id: pr.id }, null, true);
      Db.update('progetti', 'id', pr.id, { tipo: 'festival', aggiornato_il: Util.nowIso(), aggiornato_da: user.email });
      aggiornaDate(pr.id);
      Storico.log(user.email, e.id, 'produzione', 'collega', pr.id, '', { evento: e.titolo });
      return riepilogo(pr.id);
    });
  }

  function scollega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pr = trova(p && p.id);
      if (!pr) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
      var e = evento(p && p.evento_id);
      if (e.progetto_id !== pr.id) throw new CtrlError('NOT_FOUND', 'Evento non collegato a questa scheda');
      if (eventiDi(pr.id).length <= 1) throw new CtrlError('INVALID', 'Una scheda di produzione deve avere almeno un evento');
      Db.update('eventi', 'id', e.id, { progetto_id: '' }, null, true);
      aggiornaDate(pr.id);
      Storico.log(user.email, e.id, 'produzione', 'scollega', pr.id, { evento: e.titolo }, '');
      return riepilogo(pr.id);
    });
  }

  return { riepilogo: riepilogo, assicura: assicura, collega: collega, scollega: scollega };
})();

// ===== 24_Documenti.js =====
/**
 * CTRL · Documenti operativi di una produzione: Production Plan ("plan") e Material List ("materiali").
 *
 * Ogni documento è un JSON salvato per intero (spezzato in parti da 30.000 caratteri, limite delle celle).
 * Salvataggio ottimistico: il client manda la versione che ha letto; se nel frattempo è cambiata,
 * la risposta è { conflitto: true, versione, dati } (non un errore) e il client unisce le modifiche per riga.
 */
var Documenti = (function () {
  var TIPI = ['plan', 'materiali'];
  var PARTE = 30000;
  var MAX_CARATTERI = 600000;
  var CATALOGO_ATTIVITA = ['Load-in', 'Setup', 'Stage Setup', 'Backline Setup', 'Line Check', 'Soundcheck', 'Rehearsal', 'Doors Open',
    'Show Start', 'Show End', 'Changeover', 'Break', 'Lunch', 'Dinner', 'Catering', 'Load-out', 'Strike', 'Travel', 'Transfer'];

  function vivo(r) { return r && !Util.bool(r.eliminato); }
  function tipoValido(t) {
    if (TIPI.indexOf(t) < 0) throw new CtrlError('INVALID', 'Tipo di documento non valido');
    return t;
  }
  function produzione(id) {
    var p = Db.find('progetti', 'id', String(id || ''));
    if (!vivo(p)) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
    return p;
  }
  function trovaDoc(pid, tipo) {
    return Db.all('documenti').filter(function (d) { return d.progetto_id === pid && d.tipo === tipo && vivo(d); })[0] || null;
  }
  function leggi(doc) {
    var n = parseInt(doc.parti, 10) || 0;
    var parti = Db.all('documenti_parti').filter(function (r) { return r.documento_id === doc.id; })
      .sort(function (a, b) { return a.n - b.n; }).slice(0, n);
    try { return JSON.parse(parti.map(function (r) { return r.testo; }).join('')); } catch (e) { return null; }
  }

  // ---------- pulizia dei dati in arrivo ----------
  function t(v, max) { return Util.text(v, max); }
  function idv(v, i, pre) { var s = String(v || '').replace(/[^\w-]/g, '').slice(0, 40); return s || pre + '_' + i; }
  function lista(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

  function pulisciPlan(d) {
    d = d || {};
    return {
      lingua: d.lingua === 'it' ? 'it' : 'en',
      crew: lista(d.crew, 100).map(function (r, i) {
        r = r || {};
        return { id: idv(r.id, i, 'c'), nome: t(r.nome, 80), ruolo: t(r.ruolo, 80), telefono: t(r.telefono, 30), email: t(r.email, 120) };
      }),
      giorni: lista(d.giorni, 31).map(function (g, gi) {
        g = g || {};
        return {
          id: idv(g.id, gi, 'g'), data: Util.isDate(g.data) ? g.data : '',
          righe: lista(g.righe, 400).map(function (r, i) {
            r = r || {};
            return { id: idv(r.id, i, 'r'), sez: t(r.sez, 40), ora: t(r.ora, 20), att: t(r.att, 120), loc: t(r.loc, 80), note: t(r.note, 600) };
          })
        };
      })
    };
  }
  function pulisciMateriali(d) {
    d = d || {};
    return {
      sezioni: lista(d.sezioni, 100).map(function (s, si) {
        s = s || {};
        return {
          id: idv(s.id, si, 's'), nome: t(s.nome, 80),
          righe: lista(s.righe, 500).map(function (r, i) {
            r = r || {};
            return { id: idv(r.id, i, 'm'), voce: t(r.voce, 120), qta: t(r.qta, 12), unita: t(r.unita, 20), note: t(r.note, 300) };
          })
        };
      })
    };
  }
  function pulisci(tipo, d) { return tipo === 'plan' ? pulisciPlan(d) : pulisciMateriali(d); }

  // ---------- suggerimenti dai documenti già scritti ----------
  function suggerimenti(tipo, escludiDoc) {
    var docs = Db.all('documenti').filter(function (d) { return d.tipo === tipo && vivo(d) && d.id !== escludiDoc; })
      .sort(function (a, b) { return String(b.aggiornato_il).localeCompare(String(a.aggiornato_il)); }).slice(0, 40);
    var visti = {}, out = [];
    docs.forEach(function (doc) {
      var j = leggi(doc);
      if (!j) return;
      if (tipo === 'plan') {
        j.crew.forEach(function (c) {
          var k = c.nome.toLowerCase();
          if (!k || visti[k]) return;
          visti[k] = true;
          out.push({ nome: c.nome, ruolo: c.ruolo, telefono: c.telefono, email: c.email });
        });
      } else {
        j.sezioni.forEach(function (s) {
          s.righe.forEach(function (r) {
            var k = r.voce.toLowerCase();
            if (!k || visti[k]) return;
            visti[k] = true;
            out.push({ voce: r.voce, unita: r.unita, note: r.note });
          });
        });
      }
    });
    return out.slice(0, 500);
  }

  function intestazione(pid) {
    var eventi = Db.all('eventi').filter(function (e) { return e.progetto_id === pid; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    return eventi.map(function (e) {
      return { id: e.id, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data, ora_inizio: e.ora_inizio, luogo: e.luogo };
    });
  }

  function vista(user, p, tipo, doc, dati) {
    return {
      produzione: { id: p.id, nome: p.nome, tipo: p.tipo || 'evento' },
      eventi: intestazione(p.id),
      tipo: tipo,
      versione: doc ? String(doc.versione) : '0',
      dati: dati,
      aggiornato_il: doc ? doc.aggiornato_il : '',
      aggiornato_da: doc ? doc.aggiornato_da : '',
      permessi: { modificare: Users.can(user, 'modificare') },
      catalogo_attivita: tipo === 'plan' ? CATALOGO_ATTIVITA.slice() : undefined,
      suggerimenti: suggerimenti(tipo, doc && doc.id)
    };
  }

  function get(user, p) {
    var tipo = tipoValido(p && p.tipo), pr = produzione(p && p.produzione_id);
    var doc = trovaDoc(pr.id, tipo);
    return vista(user, pr, tipo, doc, doc ? leggi(doc) : null);
  }

  function scrivi(doc, testo) {
    var pezzi = [];
    for (var i = 0; i < testo.length; i += PARTE) pezzi.push(testo.slice(i, i + PARTE));
    var esist = Db.all('documenti_parti').filter(function (r) { return r.documento_id === doc.id; });
    var vecchie = {};
    esist.forEach(function (r) { vecchie[r.n] = r; });
    pezzi.forEach(function (txt, n) {
      if (vecchie[n]) Db.update('documenti_parti', 'id', vecchie[n].id, { testo: txt }, null, true);
      else Db.insert('documenti_parti', { id: doc.id + '_' + n, documento_id: doc.id, n: String(n), testo: txt });
    });
    return pezzi.length;
  }

  function salva(user, p) {
    Users.require(user, 'modificare');
    var tipo = tipoValido(p && p.tipo);
    var pr = produzione(p && p.produzione_id);
    var dati = pulisci(tipo, p && p.dati);
    var testo = JSON.stringify(dati);
    if (testo.length > MAX_CARATTERI) throw new CtrlError('INVALID', 'Documento troppo grande');
    return Db.withLock(function () {
      var doc = trovaDoc(pr.id, tipo);
      var attuale = doc ? String(doc.versione) : '0';
      if (String(p.versione || '0') !== attuale) {
        var out = vista(user, pr, tipo, doc, doc ? leggi(doc) : null);
        out.conflitto = true;
        return out;
      }
      var now = Util.nowIso(), nuova = String((parseInt(attuale, 10) || 0) + 1);
      if (!doc) {
        doc = Db.insert('documenti', { id: Util.newId('doc'), progetto_id: pr.id, tipo: tipo, versione: '0', parti: '0',
          creato_il: now, creato_da: user.email, aggiornato_il: now, aggiornato_da: user.email, eliminato: 'FALSE' });
      }
      var n = scrivi(doc, testo);
      Db.update('documenti', 'id', doc.id, { versione: nuova, parti: String(n), aggiornato_il: now, aggiornato_da: user.email }, null, true);
      var ev = intestazione(pr.id)[0];
      Storico.log(user.email, ev ? ev.id : '', 'documento', 'salva', doc.id, '', { tipo: tipo, versione: nuova, caratteri: testo.length });
      return { conflitto: false, versione: nuova, aggiornato_il: now, aggiornato_da: user.email, dati: dati };
    });
  }

  var PDF = { plan: { sezione: 'piano', prefisso: 'Production Plan - ' }, materiali: { sezione: 'materiale', prefisso: 'Material List - ' } };

  /**
   * Archivia il PDF generato dal browser come file dell'evento (sezione piano o materiale).
   * Per i festival il PDF va in tutti gli eventi collegati, come il documento.
   */
  function salvaPdf(user, p) {
    Users.require(user, 'modificare');
    p = p || {};
    var tipo = tipoValido(p.tipo);
    var pr = produzione(p.produzione_id);
    var conf = PDF[tipo];
    var nome = Util.text(p.nome, 150).replace(/[\\/]+/g, '-');
    if (nome.indexOf(conf.prefisso) !== 0 || !/\.pdf$/i.test(nome)) throw new CtrlError('INVALID', 'Nome del PDF non valido');
    if (typeof p.dati !== 'string' || !p.dati) throw new CtrlError('INVALID', 'PDF vuoto');
    if (p.dati.length > Math.ceil(Allegati.MAX_BYTE / 3) * 4 + 4) throw new CtrlError('TOO_LARGE', 'PDF troppo grande');
    var bytes;
    try { bytes = Utilities.base64Decode(p.dati); } catch (err) { throw new CtrlError('INVALID', 'PDF non leggibile'); }
    if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) throw new CtrlError('INVALID', 'Il file non è un PDF');
    return Db.withLock(function () {
      var eventi = Db.all('eventi').filter(function (e) { return e.progetto_id === pr.id; });
      if (!eventi.length) throw new CtrlError('NOT_FOUND', 'Nessun evento collegato alla scheda');
      eventi.forEach(function (e) { Allegati.sostituisciPdf(user, e, conf.sezione, conf.prefisso, nome, bytes); });
      return { eventi: eventi.map(function (e) { return e.id; }), sezione: conf.sezione, nome: nome };
    });
  }

  return { TIPI: TIPI, CATALOGO_ATTIVITA: CATALOGO_ATTIVITA, get: get, salva: salva, salvaPdf: salvaPdf, pulisci: pulisci, riepilogo: function (pid) {
    var r = {};
    TIPI.forEach(function (tp) { var d = trovaDoc(pid, tp); r[tp] = d ? { versione: d.versione, aggiornato_il: d.aggiornato_il } : null; });
    return r;
  } };
})();

// ===== 80_Api.js =====
/**
 * CTRL · Punto di ingresso dell'API.
 *
 * Il frontend invia POST con corpo JSON in text/plain (evita il preflight CORS,
 * che Apps Script non gestisce): { action, token, payload }.
 * Risposta: { ok: true, data } oppure { ok: false, error: { code, message } }.
 */
var ACTIONS = {
  'auth.requestCode': { pub: true, fn: function (u, p) { return Auth.requestCode(p); } },
  'auth.verifyCode': { pub: true, fn: function (u, p) { return Auth.verifyCode(p); } },
  'auth.me': { fn: function (u) { return Users.publicProfile(u); } },
  'auth.logout': { fn: function (u, p, token) { return Auth.logout(token); } },

  'eventi.list': { fn: function (u, p) { return Events.list(u, p); } },
  'eventi.get': { fn: function (u, p) { return Events.get(u, p); } },
  'eventi.create': { fn: function (u, p) { return Events.create(u, p); } },
  'eventi.update': { fn: function (u, p) { return Events.update(u, p); } },
  'eventi.stato': { fn: function (u, p) { return Events.setStato(u, p); } },

  'allegati.carica': { fn: function (u, p) { return Allegati.carica(u, p); } },
  'allegati.scarica': { fn: function (u, p) { return Allegati.scarica(u, p); } },
  'allegati.elimina': { fn: function (u, p) { return Allegati.elimina(u, p); } },

  'produzione.assicura': { fn: function (u, p) { return Produzioni.assicura(u, p); } },
  'produzione.collega': { fn: function (u, p) { return Produzioni.collega(u, p); } },
  'produzione.scollega': { fn: function (u, p) { return Produzioni.scollega(u, p); } },
  'documento.get': { fn: function (u, p) { return Documenti.get(u, p); } },
  'documento.salva': { fn: function (u, p) { return Documenti.salva(u, p); } },
  'documento.pdf': { fn: function (u, p) { return Documenti.salvaPdf(u, p); } },

  'sync.run': { fn: function (u) { Users.require(u, 'impostazioni'); return CalendarSync.run(u.email); } },

  'impostazioni.get': { fn: function () { return Settings.get(); } },
  'impostazioni.lista': { fn: function (u, p) { return Settings.saveList(u, p); } },

  'utenti.list': { fn: function (u) { return Users.list(u); } },
  'utenti.save': { fn: function (u, p) { return Users.save(u, p); } }
};

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Esegue un'azione: separato da doPost per poterlo testare. */
function handleRequest(body) {
  var req;
  try {
    req = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return { ok: false, error: { code: 'INVALID', message: 'Richiesta non valida' } };
  }
  try {
    if (!req || typeof req.action !== 'string' || !ACTIONS.hasOwnProperty(req.action)) {
      throw new CtrlError('INVALID', 'Azione sconosciuta');
    }
    var def = ACTIONS[req.action];
    var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    var user = def.pub ? null : Auth.current(req.token);
    Db.clearCache();
    var data = def.fn(user, payload, req.token);
    return { ok: true, data: data };
  } catch (err) {
    if (err instanceof CtrlError) {
      var out = { ok: false, error: { code: err.code, message: err.message } };
      if (err.code === 'CONFLICT' && err.extra) out.error.attuale = err.extra.attuale ? { versione: err.extra.attuale.versione } : null;
      return out;
    }
    console.error('CTRL errore interno', req && req.action, err && err.stack || err);
    return { ok: false, error: { code: 'SERVER', message: 'Errore interno. Riprova; se continua, avvisa l\'amministratore.' } };
  }
}

function doPost(e) {
  var body = e && e.postData ? e.postData.contents : '';
  return jsonOut(handleRequest(body));
}

/** Verifica rapida dal browser: mostra solo che l'API è attiva, nessun dato. */
function doGet() {
  return jsonOut({ ok: true, data: { servizio: 'CTRL API', versione: CTRL_VERSION, ambiente: Config.get('ENV', '?') } });
}

// ===== 90_Setup.js =====
/**
 * CTRL · Installazione e manutenzione automatica.
 *
 * Da eseguire UNA volta dall'editor Apps Script (menu "Esegui"):
 *   - setupProduzione()  nel progetto "CTRL API"
 *   - setupTest()        nel progetto "CTRL API TEST"
 * Sono idempotenti: rieseguirle non cancella dati, aggiunge solo ciò che manca.
 */
var ENVIRONMENTS = {
  prod: {
    ENV: 'prod',
    DB_ID: '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I',
    EVENTI_ID: '1tm4vwnFy7DuOI7WKOhBwO-5V8e58njld',
    FESTIVAL_ID: '10DavyTdm5PDRGJoFzHgJqJjNydEw_DQM',
    BACKUP_ID: '1Dpcp7dkr_KGV6t_yYPNxJAkjjLt7-l1H',
    CALENDAR_ID: 's0qardtva2jj8r09ihdl0gh1qc@group.calendar.google.com'
  },
  test: {
    ENV: 'test',
    DB_ID: '1LGIPUlgNmDBmDX5HkJ3r_67IMnd_zeoRGhZxdNQe-bM',
    EVENTI_ID: '17x8B43it-ZGY9XAk5J2RswHak-UGL_aI',
    FESTIVAL_ID: '1qFvBZKd8V2Wv6VISeC_KmHnx6U9Hfqc0',
    BACKUP_ID: '1spPomhPXAVE41odgK1aAkCi56fNDZmCm',
    // Il test legge lo stesso calendario (sola lettura): i dati scritti restano nel database di test.
    CALENDAR_ID: 's0qardtva2jj8r09ihdl0gh1qc@group.calendar.google.com'
  }
};

function setupProduzione() { return setup_('prod'); }
function setupTest() { return setup_('test'); }

function setup_(env) {
  var conf = ENVIRONMENTS[env];
  var admin = Session.getEffectiveUser().getEmail();
  var props = {};
  Object.keys(conf).forEach(function (k) { props[k] = conf[k]; });
  props.ADMIN_EMAIL = Util.normEmail(admin);
  Config.setAll(props);
  Db.clearCache();

  var log = [];
  var ss = SpreadsheetApp.openById(conf.DB_ID);
  ss.setSpreadsheetTimeZone(CTRL_TZ);
  log.push('Fuso orario del foglio: ' + CTRL_TZ);

  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      log.push('Creata tabella ' + name);
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    var added = [];
    cols.forEach(function (c) {
      if (head.indexOf(c) < 0) {
        var pos = head.filter(function (h) { return h; }).length + 1;
        sh.getRange(1, pos).setValue(c);
        head[pos - 1] = c;
        added.push(c);
      }
    });
    if (added.length) log.push(name + ': aggiunte colonne ' + added.join(', '));
    var width = head.filter(function (h) { return h; }).length;
    sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');
    sh.getRange(1, 1, 1, width).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  // Rimuove il foglio iniziale vuoto creato con il file.
  // Il nome si legge prima di eliminare: dopo deleteSheet il foglio non è più utilizzabile.
  ss.getSheets().forEach(function (sh) {
    var nome = sh.getName();
    if (!SCHEMA[nome] && ss.getSheets().length > 1 && sh.getLastRow() <= 2) {
      ss.deleteSheet(sh);
      log.push('Rimosso foglio iniziale ' + nome);
    }
  });

  Db.clearCache();
  if (!Db.find('utenti', 'email', props.ADMIN_EMAIL)) {
    Db.insert('utenti', {
      id: Util.newId('usr'), email: props.ADMIN_EMAIL, nome: 'Admin', ruolo: 'OWNER', puo_caricare: 'TRUE',
      puo_modificare: 'TRUE', attivo: 'TRUE', creato_il: Util.nowIso(), aggiornato_il: Util.nowIso(), versione: '1'
    });
    log.push('Creato proprietario ' + props.ADMIN_EMAIL);
  }
  migraRuoli_(log);
  if (!Settings.getRaw('schema_versione')) Settings.setRaw('schema_versione', String(SCHEMA_VERSION));

  installTriggers_();
  log.push('Attività automatiche: sincronizzazione ogni ora, backup ogni lunedì, pulizia sessioni ogni notte');

  var res = CalendarSync.run('setup');
  log.push('Prima sincronizzazione: ' + JSON.stringify(res));

  console.log(log.join('\n'));
  return log;
}

/**
 * Riscrive i ruoli vecchi (ADMIN, COLLABORATORE, LETTURA) in OWNER / PRODUCTION / VIEWER.
 * Idempotente. Chi perde permessi (altri ADMIN) viene disconnesso. Il proprietario è solo ADMIN_EMAIL.
 */
function migraRuoli_(log) {
  Db.clearCache();
  Db.all('utenti').forEach(function (u) {
    var nuovo = Users.ruoloDi(u);
    var daScrivere = u.ruolo !== nuovo;
    if (!daScrivere) return;
    var prima = JSON.parse(JSON.stringify(u));
    var rw = nuovo === 'VIEWER' ? 'FALSE' : 'TRUE';
    Db.update('utenti', 'email', u.email, { ruolo: nuovo, puo_caricare: rw, puo_modificare: rw, aggiornato_il: Util.nowIso() });
    Storico.log('setup', '', 'utenti', 'ruolo_migrato', u.email, prima.ruolo, nuovo);
    if (String(prima.ruolo).toUpperCase() === 'ADMIN' && nuovo !== 'OWNER') Auth.revokeAll(u.email);
    log.push('Ruolo ' + u.email + ': ' + prima.ruolo + ' → ' + nuovo);
  });
}

function installTriggers_() {
  var wanted = { syncOraria: true, backupSettimanale: true, puliziaNotturna: true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncOraria').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('backupSettimanale').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();
  ScriptApp.newTrigger('puliziaNotturna').timeBased().everyDays(1).atHour(3).create();
}

/** Attività automatiche (trigger). */
function syncOraria() {
  try { CalendarSync.run(''); }
  catch (e) { Settings.setRaw('sync_esito', { errore: String(e.message || e) }); throw e; }
}

function backupSettimanale() { return Backup.run(); }

function puliziaNotturna() { return Auth.purgeExpired(); }

var Backup = (function () {
  var KEEP = 8;
  function run() {
    var folder = DriveApp.getFolderById(Config.require('BACKUP_ID'));
    var src = DriveApp.getFileById(Config.require('DB_ID'));
    var name = 'CTRL backup ' + Utilities.formatDate(new Date(), CTRL_TZ, 'yyyy-MM-dd HH.mm');
    src.makeCopy(name, folder);
    var files = [];
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf('CTRL backup ') === 0) files.push(f);
    }
    files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    files.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
    return { creato: name, conservati: Math.min(files.length, KEEP) };
  }
  return { run: run };
})();
