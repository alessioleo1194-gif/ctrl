/**
 * CTRL API · versione 0.1.0
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
var CTRL_VERSION = '0.1.0';
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
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
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
var SCHEMA_VERSION = 1;

var SCHEMA = {
  eventi: ['id', 'origine', 'cal_key', 'titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo',
    'descrizione', 'colore', 'progetto_id', 'cartella_id', 'stato', 'note',
    'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'versione', 'sync_il'],
  attivita: ['id', 'evento_id', 'ora_inizio', 'ora_fine', 'attivita', 'responsabile', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  materiale: ['id', 'evento_id', 'voce', 'quantita', 'area', 'provenienza', 'fornitore', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  canali: ['id', 'evento_id', 'numero', 'sorgente', 'microfono', 'di', 'asta', 'note', 'ordine',
    'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione'],
  testi: ['id', 'evento_id', 'sezione', 'testo', 'aggiornato_il', 'aggiornato_da', 'versione'],
  allegati: ['id', 'evento_id', 'sezione', 'drive_id', 'nome', 'mime', 'byte', 'caricato_da', 'caricato_il',
    'nel_cestino'],
  progetti: ['id', 'nome', 'tipo', 'data', 'data_fine', 'cartella_id', 'stato', 'creato_il', 'aggiornato_il',
    'versione'],
  location: ['id', 'progetto_id', 'nome', 'indirizzo', 'note', 'versione'],
  utenti: ['id', 'email', 'nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo', 'creato_il',
    'aggiornato_il', 'versione', 'ultimo_accesso'],
  sessioni: ['hash', 'email', 'creata', 'scade', 'ultimo_uso', 'dispositivo'],
  condivisioni: ['id', 'hash', 'eventi', 'sezioni', 'mostra_contatti', 'scade', 'revocato', 'creato_da',
    'creato_il', 'ultimo_accesso', 'etichetta'],
  storico: ['ts', 'email', 'evento_id', 'sezione', 'azione', 'rif_id', 'prima', 'dopo'],
  config: ['chiave', 'valore', 'aggiornato_il']
};

var RUOLI = ['ADMIN', 'COLLABORATORE', 'LETTURA'];
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
  function update(name, keyField, keyValue, patch, expectedVersion) {
    var t = read(name);
    var row = find(name, keyField, keyValue);
    if (!row) throw new CtrlError('NOT_FOUND', 'Elemento non trovato');
    if (expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== String(row.versione || '0')) {
      throw new CtrlError('CONFLICT', 'Modificato da un altro utente. Ricarica e riprova.', { attuale: row });
    }
    var next = {};
    t.head.forEach(function (h) { next[h] = row[h]; });
    Object.keys(patch).forEach(function (k) { if (t.head.indexOf(k) >= 0) next[k] = patch[k]; });
    if (t.head.indexOf('versione') >= 0) next.versione = String((parseInt(row.versione, 10) || 0) + 1);
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
 * - ADMIN: tutto. L'email in ADMIN_EMAIL è sempre admin, anche se il foglio viene modificato.
 * - COLLABORATORE: legge tutto; carica file se puo_caricare; modifica contenuti se puo_modificare.
 * - LETTURA: legge e scarica.
 */
var Users = (function () {
  function adminEmail() { return Util.normEmail(Config.get('ADMIN_EMAIL', '')); }

  function byEmail(email) {
    var e = Util.normEmail(email);
    var u = Db.find('utenti', 'email', e);
    if (!u && e && e === adminEmail()) {
      return { id: 'usr_admin', email: e, nome: 'Admin', ruolo: 'ADMIN', puo_caricare: 'TRUE', puo_modificare: 'TRUE', attivo: 'TRUE' };
    }
    if (u && e === adminEmail()) {
      u = JSON.parse(JSON.stringify(u));
      u.ruolo = 'ADMIN'; u.attivo = 'TRUE';
    }
    return u;
  }

  function perms(u) {
    var admin = u.ruolo === 'ADMIN';
    var collab = u.ruolo === 'COLLABORATORE';
    return {
      admin: admin,
      vedere: true,
      caricare: admin || (collab && Util.bool(u.puo_caricare)),
      modificare: admin || (collab && Util.bool(u.puo_modificare)),
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
        id: u.id, email: u.email, nome: u.nome, ruolo: u.email === adminEmail() ? 'ADMIN' : u.ruolo,
        puo_caricare: Util.bool(u.puo_caricare), puo_modificare: Util.bool(u.puo_modificare),
        attivo: Util.bool(u.attivo), ultimo_accesso: u.ultimo_accesso, versione: u.versione,
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
    if (RUOLI.indexOf(ruolo) < 0) throw new CtrlError('INVALID', 'Ruolo non valido');
    var isAdminMail = email === adminEmail();
    if (isAdminMail && (ruolo !== 'ADMIN' || p.attivo === false)) {
      throw new CtrlError('INVALID', 'L\'amministratore principale non può essere declassato o disattivato');
    }
    var fields = {
      email: email,
      nome: Util.text(p.nome, 80),
      ruolo: ruolo,
      puo_caricare: ruolo === 'ADMIN' || (ruolo === 'COLLABORATORE' && !!p.puo_caricare) ? 'TRUE' : 'FALSE',
      puo_modificare: ruolo === 'ADMIN' || (ruolo === 'COLLABORATORE' && !!p.puo_modificare) ? 'TRUE' : 'FALSE',
      attivo: p.attivo === false ? 'FALSE' : 'TRUE',
      aggiornato_il: Util.nowIso()
    };
    return Db.withLock(function () {
      var existing = Db.find('utenti', 'email', email);
      var out;
      if (existing) {
        var before = JSON.parse(JSON.stringify(existing));
        out = Db.update('utenti', 'email', email, fields, p.versione);
        var d = Storico.diff(before, out, ['nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo']);
        if (d.changed) Storico.log(actor.email, '', 'utenti', 'modifica', email, d.prima, d.dopo);
        var lostAccess = before.attivo !== out.attivo && out.attivo === 'FALSE';
        var demoted = before.ruolo !== out.ruolo || before.puo_modificare !== out.puo_modificare || before.puo_caricare !== out.puo_caricare;
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
    byEmail: byEmail, perms: perms, can: can, require: require_, publicProfile: publicProfile,
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

  function contaSezioni() {
    var out = {};
    function bump(id, k) {
      if (!out[id]) out[id] = { piano: 0, materiale: 0, scheda: 0 };
      out[id][k]++;
    }
    Db.all('attivita').forEach(function (r) { if (!Util.bool(r.eliminato)) bump(r.evento_id, 'piano'); });
    Db.all('materiale').forEach(function (r) { if (!Util.bool(r.eliminato)) bump(r.evento_id, 'materiale'); });
    Db.all('canali').forEach(function (r) { if (!Util.bool(r.eliminato)) bump(r.evento_id, 'scheda'); });
    Db.all('testi').forEach(function (r) {
      if (r.testo && ['piano', 'materiale', 'scheda'].indexOf(r.sezione) >= 0) bump(r.evento_id, r.sezione);
    });
    Db.all('allegati').forEach(function (r) {
      if (!Util.bool(r.nel_cestino) && ['piano', 'materiale', 'scheda'].indexOf(r.sezione) >= 0) bump(r.evento_id, r.sezione);
    });
    return out;
  }

  function view(e, conteggi, user) {
    var c = conteggi[e.id] || { piano: 0, materiale: 0, scheda: 0 };
    var v = {
      id: e.id, origine: e.origine, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data,
      ora_inizio: e.ora_inizio, ora_fine: e.ora_fine, luogo: e.luogo, descrizione: e.descrizione,
      colore: e.colore || COLORE_DEFAULT, stato: e.stato, note: e.note, versione: e.versione,
      aggiornato_il: e.aggiornato_il, aggiornato_da: e.aggiornato_da,
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
      return view(row, {}, user);
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
      return view(row, contaSezioni(), user);
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
      return view(row, contaSezioni(), user);
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
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && ss.getSheets().length > 1 && sh.getLastRow() <= 2) {
      ss.deleteSheet(sh);
      log.push('Rimosso foglio iniziale ' + sh.getName());
    }
  });

  Db.clearCache();
  if (!Db.find('utenti', 'email', props.ADMIN_EMAIL)) {
    Db.insert('utenti', {
      id: Util.newId('usr'), email: props.ADMIN_EMAIL, nome: 'Admin', ruolo: 'ADMIN', puo_caricare: 'TRUE',
      puo_modificare: 'TRUE', attivo: 'TRUE', creato_il: Util.nowIso(), aggiornato_il: Util.nowIso(), versione: '1'
    });
    log.push('Creato amministratore ' + props.ADMIN_EMAIL);
  }
  if (!Settings.getRaw('schema_versione')) Settings.setRaw('schema_versione', String(SCHEMA_VERSION));

  installTriggers_();
  log.push('Attività automatiche: sincronizzazione ogni ora, backup ogni lunedì, pulizia sessioni ogni notte');

  var res = CalendarSync.run('setup');
  log.push('Prima sincronizzazione: ' + JSON.stringify(res));

  console.log(log.join('\n'));
  return log;
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
