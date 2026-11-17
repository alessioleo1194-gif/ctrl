/**
 * CTRL API · versione 0.10.1
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
var CTRL_VERSION = '0.10.1';
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

  /** Oggi, nel fuso dello script (yyyy-MM-dd). */
  function today() {
    return fmtDate(new Date());
  }

  /** Giorni interi da a a b (date yyyy-MM-dd). */
  function diffDays(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
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
    nowIso: nowIso, fmtDate: fmtDate, fmtTime: fmtTime, addDays: addDays, today: today, diffDays: diffDays,
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
var SCHEMA_VERSION = 7;

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
  // scade_il: ultimo giorno di accesso (yyyy-MM-dd, ora italiana); vuoto = nessuna scadenza
  // nome_calendario: come la persona compare nelle descrizioni del Calendar (alias separati da virgola)
  // colore: uno di COLORI_UTENTE, uguale per la stessa persona ovunque nell'interfaccia
  utenti: ['id', 'email', 'nome', 'ruolo', 'puo_caricare', 'puo_modificare', 'attivo', 'creato_il',
    'aggiornato_il', 'versione', 'ultimo_accesso', 'scade_il', 'nome_calendario', 'colore',
    // permessi_extra: eccezioni al ruolo, separate da virgola (tutti_documenti, carica, modifica). eliminato: TRUE = utente tolto (riga conservata).
    'permessi_extra', 'eliminato', 'eliminato_il'],
  // staff assegnato agli eventi. stato: proposta (da confermare), confermata, scartata, rimossa, decaduta.
  // origine: calendario (trovato nella descrizione) o manuale. trovato/termine: dove e cosa è stato trovato.
  assegnazioni: ['id', 'evento_id', 'email', 'stato', 'origine', 'trovato', 'termine', 'creata_il', 'creata_da',
    'aggiornata_il', 'aggiornata_da'],
  sessioni: ['hash', 'email', 'creata', 'scade', 'ultimo_uso', 'dispositivo'],
  condivisioni: ['id', 'hash', 'eventi', 'sezioni', 'mostra_contatti', 'scade', 'revocato', 'creato_da',
    'creato_il', 'ultimo_accesso', 'etichetta'],
  // richieste di accesso fatte da chi non ha ancora un account (stato: in_attesa, approvata, rifiutata)
  richieste_accesso: ['id', 'email', 'nome', 'messaggio', 'creata_il', 'stato', 'gestita_il', 'gestita_da', 'ruolo', 'scade_il'],
  // registro accessi: solo aggiunta, le righe oltre 180 giorni si cancellano da sole (come le sessioni)
  accessi: ['ts', 'email', 'evento', 'esito', 'dispositivo', 'dettaglio', 'attore'],
  storico: ['ts', 'email', 'evento_id', 'sezione', 'azione', 'rif_id', 'prima', 'dopo'],
  config: ['chiave', 'valore', 'aggiornato_il']
};

// OWNER è solo l'email in ADMIN_EMAIL e non si assegna dal portale.
var RUOLI = ['OWNER', 'PRODUCTION', 'VIEWER'];
var RUOLI_ASSEGNABILI = ['PRODUCTION', 'VIEWER'];
var COLORI_UTENTE = ['blu', 'verde', 'arancio', 'viola', 'rosa', 'turchese', 'giallo', 'rosso'];
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
 * - Accessi, logout, codici errati e accessi scaduti finiscono nel registro accessi (solo utenti esistenti).
 * - Un utente con accesso scaduto (scade_il passata) non entra e le sue sessioni non valgono più.
 */
var Auth = (function () {
  var CODE_TTL_MIN = 10;
  var CODE_MAX_TRIES = 5;
  var SESSION_DAYS = 30;
  var TOUCH_EVERY_MIN = 60;

  function cache() { return CacheService.getScriptCache(); }

  function key(prefix, email) { return prefix + Util.sha256(email).slice(0, 40); }

  function dev(payload) { return Util.text(payload && payload.dispositivo, 120); }

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
      Accessi.logSafe(email, rec.tries >= CODE_MAX_TRIES ? 'codici_esauriti' : 'codice_errato', 'ko', dev(payload),
        'Tentativo ' + rec.tries + ' di ' + CODE_MAX_TRIES);
      if (rec.tries >= CODE_MAX_TRIES) {
        c.remove(k);
        throw new CtrlError('CODE_EXPIRED', 'Troppi tentativi. Chiedi un nuovo codice.');
      }
      c.put(k, JSON.stringify(rec), Math.max(1, Math.round((rec.exp - Date.now()) / 1000)));
      throw new CtrlError('CODE_WRONG', 'Codice errato. Tentativi rimasti: ' + (CODE_MAX_TRIES - rec.tries));
    }
    c.remove(k);

    var user = Users.byEmail(email);
    if (!user || !Util.bool(user.attivo)) {
      if (user) Accessi.logSafe(email, 'accesso_negato', 'ko', dev(payload), 'Accesso disattivato');
      throw new CtrlError('FORBIDDEN', 'Accesso non autorizzato');
    }
    if (Users.scaduto(user)) {
      Accessi.logSafe(email, 'accesso_scaduto', 'scaduto', dev(payload), 'Valido fino al ' + (user.scade_il || '?'));
      throw new CtrlError('FORBIDDEN', 'Accesso scaduto. Chiedi di riattivarlo a chi gestisce CTRL.');
    }

    return Db.withLock(function () {
      var token = Util.newToken();
      var now = Util.nowIso();
      var exp = new Date(Date.now() + SESSION_DAYS * 86400000);
      Db.insert('sessioni', {
        hash: Util.sha256(token), email: email, creata: now,
        scade: Utilities.formatDate(exp, CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss"), ultimo_uso: now,
        dispositivo: dev(payload)
      });
      Users.touchLogin(email);
      Accessi.log(email, 'login', 'ok', dev(payload), '');
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
    if (Users.scaduto(user)) throw new CtrlError('AUTH_REQUIRED', 'Accesso scaduto. Chiedi di riattivarlo a chi gestisce CTRL.');
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
    Db.withLock(function () {
      var s = Db.find('sessioni', 'hash', h);
      if (!s) return;
      Accessi.log(s.email, 'logout', 'ok', s.dispositivo, '');
      Db.removeRow('sessioni', 'hash', h);
    });
    return { ok: true };
  }

  /** Chiude tutte le sessioni di un utente (disattivazione, cambio ruolo). */
  function revokeAll(email) {
    var rows = Db.all('sessioni').filter(function (s) { return s.email === email; });
    rows.forEach(function (s) { Db.removeRow('sessioni', 'hash', s.hash); });
    return rows.length;
  }

  /** Sessioni valide di un utente, senza dati segreti: l'id è solo l'inizio dell'impronta. */
  function sessionsOf(email) {
    var now = Util.nowIso();
    return Db.all('sessioni')
      .filter(function (s) { return s.email === email && s.scade >= now; })
      .sort(function (a, b) { return a.ultimo_uso < b.ultimo_uso ? 1 : -1; })
      .map(function (s) { return { id: s.hash.slice(0, 16), creata: s.creata, ultimo_uso: s.ultimo_uso, dispositivo: s.dispositivo }; });
  }

  /** Chiude una sessione (id) o tutte quelle di un utente, su richiesta del proprietario. */
  function revoke(actor, email, id) {
    return Db.withLock(function () {
      var n;
      if (id) {
        if (String(id).length < 8) throw new CtrlError('INVALID', 'Dispositivo non valido');
        var hit = Db.all('sessioni').filter(function (s) { return s.email === email && s.hash.indexOf(String(id)) === 0; });
        hit.forEach(function (s) { Db.removeRow('sessioni', 'hash', s.hash); });
        n = hit.length;
      } else {
        n = revokeAll(email);
      }
      if (n) Accessi.log(email, 'disconnessione', 'ok', '', id ? 'Un dispositivo' : 'Tutti i dispositivi (' + n + ')', actor.email);
      return { chiuse: n };
    });
  }

  /** Chiude le sessioni di chi ha superato la scadenza (notte). */
  function closeExpiredUsers() {
    return Db.withLock(function () {
      var tot = 0;
      Db.all('utenti').forEach(function (u) {
        if (!Users.scaduto(u)) return;
        var n = revokeAll(u.email);
        if (n) {
          tot += n;
          Accessi.log(u.email, 'accesso_scaduto', 'scaduto', '', 'Sessioni chiuse: ' + n + ' · valido fino al ' + (u.scade_il || '?'), 'sistema');
        }
      });
      return tot;
    });
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

  return {
    requestCode: requestCode, verifyCode: verifyCode, current: current, logout: logout, revokeAll: revokeAll,
    purgeExpired: purgeExpired, sessionsOf: sessionsOf, revoke: revoke, closeExpiredUsers: closeExpiredUsers
  };
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
 * Ogni utente (tranne il proprietario) può avere una scadenza: scade_il è l'ultimo giorno di accesso (ora italiana).
 * Permessi particolari (permessi_extra): eccezioni al ruolo, spente di default. tutti_documenti = vede documenti, file e note
 * di ogni evento anche senza assegnazione; carica = può caricare file; modifica = può modificare Plan e Material List.
 * Eliminare un utente non cancella la riga: eliminato = TRUE, non può entrare, sparisce da elenco ed eventi.
 * Dal giorno dopo l'accesso è rifiutato e le sessioni vengono chiuse. Una data non valida nel foglio vale "scaduto".
 * I valori vecchi nel foglio (ADMIN, COLLABORATORE, LETTURA) vengono letti come i nuovi: ADMIN diverso dal proprietario
 * vale PRODUCTION, COLLABORATORE con puo_modificare vale PRODUCTION, gli altri VIEWER. Il setup li riscrive.
 */
var Users = (function () {
  /** Nome mostrato per il proprietario (così gli altri sanno chi è, non vedono "admin"). */
  var NOME_OWNER = 'Alessio Leo';
  var NOMI_GENERICI = ['', 'admin', 'owner', 'amministratore', 'administrator'];
  var PERMESSI_EXTRA = ['tutti_documenti', 'carica', 'modifica'];

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

  var ETICHETTE = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };
  function etichettaRuolo(r) { return ETICHETTE[r] || r; }

  /** True se l'accesso è oltre la scadenza. Il proprietario non scade mai. */
  function scaduto(u) {
    if (!u || ruoloDi(u) === 'OWNER') return false;
    var s = u.scade_il;
    if (!s) return false;
    return !Util.isDate(s) || Util.today() > s;
  }

  /** Il proprietario si presenta col suo nome, mai come "Admin" o "Owner". */
  function nomeOwner_(nome) {
    return NOMI_GENERICI.indexOf(String(nome || '').trim().toLowerCase()) >= 0 ? NOME_OWNER : String(nome).trim();
  }

  function byEmail(email) {
    var e = Util.normEmail(email);
    var u = Db.find('utenti', 'email', e);
    if (!u && e && e === adminEmail()) {
      return { id: 'usr_admin', email: e, nome: NOME_OWNER, ruolo: 'OWNER', attivo: 'TRUE' };
    }
    if (u && Util.bool(u.eliminato) && e !== adminEmail()) return undefined;
    if (u) {
      u = JSON.parse(JSON.stringify(u));
      u.ruolo = ruoloDi(u);
      if (e === adminEmail()) { u.attivo = 'TRUE'; u.nome = nomeOwner_(u.nome); }
    }
    return u;
  }

  /** Permessi particolari validi di una riga utente. */
  function extraDi(u) {
    return String((u && u.permessi_extra) || '').split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return PERMESSI_EXTRA.indexOf(x) >= 0; });
  }

  function perms(u) {
    var admin = u.ruolo === 'OWNER';
    var prod = u.ruolo === 'PRODUCTION';
    var extra = admin ? [] : extraDi(u);
    return {
      admin: admin,
      vedere: true,
      caricare: admin || prod || extra.indexOf('carica') >= 0,
      modificare: admin || prod || extra.indexOf('modifica') >= 0,
      vedereTutto: admin || extra.indexOf('tutti_documenti') >= 0,
      vedereEventi: admin || prod || extra.indexOf('tutti_documenti') >= 0,   // elenco completo degli eventi (il Viewer vede solo i suoi)
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

  /** Colore della persona: quello scelto, altrimenti uno stabile ricavato dall'email (così non cambia mai a ogni lettura). */
  function coloreDi(u) {
    if (u && COLORI_UTENTE.indexOf(u.colore) >= 0) return u.colore;
    var h = 0, e = Util.normEmail(u && u.email);
    for (var i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) % 997;
    return COLORI_UTENTE[h % COLORI_UTENTE.length];
  }

  /** Il colore meno usato tra gli utenti (a parità, il primo della tavolozza). Da chiamare dentro Db.withLock. */
  function scegliColore(escludiEmail) {
    var usi = {};
    COLORI_UTENTE.forEach(function (c) { usi[c] = 0; });
    Db.all('utenti').forEach(function (u) {
      if (Util.normEmail(u.email) === escludiEmail || Util.bool(u.eliminato)) return;
      if (usi.hasOwnProperty(u.colore)) usi[u.colore]++;
    });
    return COLORI_UTENTE.slice().sort(function (a, b) { return usi[a] - usi[b] || COLORI_UTENTE.indexOf(a) - COLORI_UTENTE.indexOf(b); })[0];
  }

  function publicProfile(u) {
    return { id: u.id || '', email: u.email, nome: u.nome || u.email, ruolo: u.ruolo, colore: coloreDi(u), permessi: perms(u) };
  }

  function touchLogin(email) {
    var u = Db.find('utenti', 'email', email);
    // ultimo_accesso è un dato tecnico: non deve invalidare la scheda che l'Owner ha aperto (keepVersion)
    if (u) Db.update('utenti', 'email', email, { ultimo_accesso: Util.nowIso() }, null, true);
  }

  function list(actor) {
    require_(actor, 'impostazioni');
    var now = Util.nowIso();
    var sessioni = {};
    Db.all('sessioni').forEach(function (x) { if (x.scade >= now) sessioni[x.email] = (sessioni[x.email] || 0) + 1; });
    var oggi = Util.today();
    return Db.all('utenti').filter(function (u) { return !Util.bool(u.eliminato); }).map(function (u) {
      var owner = ruoloDi(u) === 'OWNER';
      var scade = owner ? '' : (u.scade_il || '');
      var valida = Util.isDate(scade);
      return {
        id: u.id, email: u.email, nome: owner ? nomeOwner_(u.nome) : u.nome, ruolo: ruoloDi(u),
        attivo: Util.bool(u.attivo) || u.email === adminEmail(), ultimo_accesso: u.ultimo_accesso, versione: u.versione,
        protetto: u.email === adminEmail(),
        scade_il: scade, scaduto: scaduto(u), giorni_rimasti: valida && !scaduto(u) ? Util.diffDays(oggi, scade) : null,
        sessioni: sessioni[u.email] || 0,
        nome_calendario: u.nome_calendario || '', colore: coloreDi(u),
        permessi_extra: owner ? [] : extraDi(u)
      };
    }).sort(function (a, b) { return a.email < b.email ? -1 : 1; });
  }

  var ETICHETTE_EXTRA = { tutti_documenti: 'vede tutti i documenti', carica: 'carica file', modifica: 'modifica Plan e Material' };

  function elencoExtra_(v) {
    var l = String(v || '').split(',').filter(Boolean).map(function (x) { return ETICHETTE_EXTRA[x] || x; });
    return l.length ? l.join(', ') : 'nessuno';
  }

  /** Lista pulita dei permessi particolari: solo valori noti, senza doppi, in ordine fisso. */
  function normExtra_(v) {
    if (!Array.isArray(v)) throw new CtrlError('INVALID', 'Permessi particolari non validi');
    v.forEach(function (x) { if (PERMESSI_EXTRA.indexOf(String(x)) < 0) throw new CtrlError('INVALID', 'Permesso non valido'); });
    return PERMESSI_EXTRA.filter(function (x) { return v.indexOf(x) >= 0; });
  }

  /** Crea o aggiorna un utente. Con email_nuova cambia l'email dello stesso profilo. */
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
    var nuovaEmail = '';
    if (p.email_nuova !== undefined && p.email_nuova !== null && Util.normEmail(p.email_nuova) !== email) {
      nuovaEmail = Util.normEmail(p.email_nuova);
      if (isAdminMail) throw new CtrlError('INVALID', 'L\'email del proprietario non si cambia');
      if (!Util.isEmail(nuovaEmail)) throw new CtrlError('INVALID', 'Nuova email non valida');
      if (nuovaEmail === adminEmail()) throw new CtrlError('INVALID', 'Questa email è riservata al proprietario');
    }
    var extra;
    if (p.permessi_extra !== undefined) {
      extra = normExtra_(p.permessi_extra);
      if (isAdminMail && extra.length) throw new CtrlError('INVALID', 'Il proprietario ha già tutti i permessi');
    }
    var scade;
    if (p.scade_il !== undefined) {
      scade = p.scade_il === null ? '' : String(p.scade_il).trim();
      if (scade && !Util.isDate(scade)) throw new CtrlError('INVALID', 'Data di scadenza non valida');
      if (scade && isAdminMail) throw new CtrlError('INVALID', 'Il proprietario non ha scadenza');
    }
    var colore;
    if (p.colore !== undefined && p.colore !== null && p.colore !== '') {
      colore = String(p.colore);
      if (COLORI_UTENTE.indexOf(colore) < 0) throw new CtrlError('INVALID', 'Colore non valido');
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
    if (scade !== undefined) fields.scade_il = scade;
    if (extra !== undefined) fields.permessi_extra = extra.join(',');
    if (p.nome_calendario !== undefined) fields.nome_calendario = Util.text(p.nome_calendario, 200);
    if (colore) fields.colore = colore;
    return Db.withLock(function () {
      var existing = Db.find('utenti', 'email', email);
      var out;
      if (nuovaEmail) {
        if (!existing || Util.bool(existing.eliminato)) throw new CtrlError('NOT_FOUND', 'Utente non trovato');
        if (Db.find('utenti', 'email', nuovaEmail)) throw new CtrlError('CONFLICT', 'Questa email è già usata da un altro utente');
        fields.email = nuovaEmail;
      }
      var tornato = !!(existing && Util.bool(existing.eliminato));   // email di un utente eliminato: lo si riattiva
      if (existing) {
        var before = JSON.parse(JSON.stringify(existing));
        if (tornato) { fields.eliminato = ''; fields.eliminato_il = ''; if (extra === undefined) fields.permessi_extra = ''; }
        out = Db.update('utenti', 'email', email, fields, tornato ? undefined : p.versione);
        if (!out.colore && !fields.colore) { out = Db.update('utenti', 'email', out.email, { colore: scegliColore(out.email) }, null, true); }
        var d = Storico.diff(before, out, ['nome', 'email', 'ruolo', 'attivo', 'scade_il', 'nome_calendario', 'colore', 'permessi_extra']);
        if (d.changed) Storico.log(actor.email, '', 'utenti', 'modifica', out.email, d.prima, d.dopo);
        var lostAccess = before.attivo !== out.attivo && out.attivo === 'FALSE';
        var demoted = ruoloDi(before) !== ruoloDi(out);
        if (nuovaEmail) {
          Db.all('assegnazioni').forEach(function (r) {
            if (r.email === email) Db.update('assegnazioni', 'id', r.id, { email: nuovaEmail, aggiornata_il: Util.nowIso(), aggiornata_da: actor.email });
          });
        }
        if (lostAccess || demoted || nuovaEmail) Auth.revokeAll(email);
        if (nuovaEmail) Accessi.log(nuovaEmail, 'email_cambiata', 'ok', '', email + ' → ' + nuovaEmail, actor.email);
        if (tornato) Accessi.log(out.email, 'utente_creato', 'ok', '', etichettaRuolo(ruolo) + (out.scade_il ? ' · fino al ' + out.scade_il : '') + ' · già presente, riattivato', actor.email);
        if (demoted) Accessi.log(out.email, 'ruolo', 'ok', '', etichettaRuolo(ruoloDi(before)) + ' → ' + etichettaRuolo(ruoloDi(out)), actor.email);
        if ((before.scade_il || '') !== (out.scade_il || '')) {
          Accessi.log(out.email, 'scadenza', 'ok', '', (before.scade_il || 'nessuna') + ' → ' + (out.scade_il || 'nessuna'), actor.email);
        }
        if ((before.permessi_extra || '') !== (out.permessi_extra || '') && !tornato) {
          Accessi.log(out.email, 'permessi', 'ok', '', elencoExtra_(out.permessi_extra), actor.email);
        }
        if (lostAccess) Accessi.log(out.email, 'disattivato', 'ok', '', '', actor.email);
        else if (before.attivo === 'FALSE' && out.attivo === 'TRUE' && !tornato) Accessi.log(out.email, 'riattivato', 'ok', '', '', actor.email);
      } else {
        fields.id = Util.newId('usr');
        if (!fields.colore) fields.colore = scegliColore('');
        fields.creato_il = Util.nowIso();
        fields.versione = '1';
        out = Db.insert('utenti', fields);
        Storico.log(actor.email, '', 'utenti', 'crea', email, '', { ruolo: ruolo });
        Accessi.log(email, 'utente_creato', 'ok', '', etichettaRuolo(ruolo) + (out.scade_il ? ' · fino al ' + out.scade_il : ''), actor.email);
        if (out.permessi_extra) Accessi.log(email, 'permessi', 'ok', '', elencoExtra_(out.permessi_extra), actor.email);
      }
      // nome, alias o stato possono cambiare chi viene trovato nelle descrizioni
      Staff.ricalcolaSicuro_();
      return { email: out.email, versione: out.versione };
    });
  }

  /**
   * Elimina un utente senza cancellare la riga: non può più entrare, le sessioni si chiudono, sparisce dall'elenco
   * e dagli eventi. Il registro accessi e lo storico restano. La stessa email si può registrare di nuovo.
   */
  function elimina(actor, p) {
    require_(actor, 'impostazioni');
    var email = Util.normEmail(p && p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    if (email === adminEmail()) throw new CtrlError('INVALID', 'Il proprietario non si può eliminare');
    return Db.withLock(function () {
      var u = Db.find('utenti', 'email', email);
      if (!u || Util.bool(u.eliminato)) throw new CtrlError('NOT_FOUND', 'Utente non trovato');
      var ora = Util.nowIso();
      Db.update('utenti', 'email', email, { eliminato: 'TRUE', eliminato_il: ora, attivo: 'FALSE', aggiornato_il: ora });
      var sessioni = Auth.revokeAll(email);
      var tolte = 0;
      Db.all('assegnazioni').forEach(function (r) {
        if (r.email !== email) return;
        if (r.stato === 'confermata') { Db.update('assegnazioni', 'id', r.id, { stato: 'rimossa', aggiornata_il: ora, aggiornata_da: actor.email }); tolte++; }
        else if (r.stato === 'proposta') Db.update('assegnazioni', 'id', r.id, { stato: 'decaduta', aggiornata_il: ora, aggiornata_da: actor.email });
      });
      Storico.log(actor.email, '', 'utenti', 'elimina', email, { ruolo: ruoloDi(u), nome: u.nome }, '');
      Accessi.log(email, 'eliminato', 'ok', '', etichettaRuolo(ruoloDi(u)) + (tolte ? ' · tolto da ' + tolte + ' event' + (tolte === 1 ? 'o' : 'i') : ''), actor.email);
      Staff.ricalcolaSicuro_();
      return { email: email, sessioni_chiuse: sessioni || 0, assegnazioni_tolte: tolte };
    });
  }

  /** Allunga la scadenza di 7 o 30 giorni, dalla data attuale o da oggi se già scaduta. */
  function proroga(actor, p) {
    require_(actor, 'impostazioni');
    var email = Util.normEmail(p && p.email);
    var giorni = Number(p && p.giorni);
    if (giorni !== 7 && giorni !== 30) throw new CtrlError('INVALID', 'Durata non valida');
    return Db.withLock(function () {
      var u = Db.find('utenti', 'email', email);
      if (!u) throw new CtrlError('NOT_FOUND', 'Utente non trovato');
      if (ruoloDi(u) === 'OWNER') throw new CtrlError('INVALID', 'Il proprietario non ha scadenza');
      if (!u.scade_il) throw new CtrlError('INVALID', 'Questo utente non ha una scadenza');
      var oggi = Util.today();
      var base = Util.isDate(u.scade_il) && u.scade_il > oggi ? u.scade_il : oggi;
      var nuova = Util.addDays(base, giorni);
      var prima = u.scade_il;
      Db.update('utenti', 'email', email, { scade_il: nuova, aggiornato_il: Util.nowIso() });
      Storico.log(actor.email, '', 'utenti', 'modifica', email, { scade_il: prima }, { scade_il: nuova });
      Accessi.log(email, 'scadenza', 'ok', '', prima + ' → ' + nuova, actor.email);
      return { email: email, scade_il: nuova };
    });
  }

  return {
    proroga: proroga, scaduto: scaduto, etichettaRuolo: etichettaRuolo,
    byEmail: byEmail, ruoloDi: ruoloDi, perms: perms, can: can, require: require_, publicProfile: publicProfile,
    touchLogin: touchLogin, nomeOwner: nomeOwner_, list: list, save: save, elimina: elimina, extraDi: extraDi, adminEmail: adminEmail, coloreDi: coloreDi, scegliColore: scegliColore
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

// ===== 13_Accessi.js =====
/**
 * CTRL · Registro accessi (ACCESS LOG).
 *
 * Solo aggiunta, visibile solo al proprietario. Registra: accessi riusciti, logout, codici errati di utenti
 * esistenti, accessi scaduti o negati, richieste di accesso e loro esito, cambi di ruolo / scadenza / stato,
 * disconnessioni remote. NON registra: codici, token, tentativi di email sconosciute (solo la richiesta esplicita),
 * indirizzo IP (Apps Script non lo espone). Il dispositivo è quello dichiarato dal browser, quindi falsificabile.
 * Le righe oltre 180 giorni si cancellano ogni notte.
 */
var Accessi = (function () {
  var CONSERVA_GIORNI = 180;
  var MAX_RIGHE = 500;

  var CATEGORIE = {
    login: 'accessi', logout: 'accessi',
    codice_errato: 'problemi', codici_esauriti: 'problemi', accesso_scaduto: 'problemi', accesso_negato: 'problemi',
    richiesta: 'richieste', richiesta_approvata: 'richieste', richiesta_rifiutata: 'richieste',
    utente_creato: 'amministrazione', ruolo: 'amministrazione', scadenza: 'amministrazione',
    disattivato: 'amministrazione', riattivato: 'amministrazione', disconnessione: 'amministrazione',
    email_cambiata: 'amministrazione', permessi: 'amministrazione', eliminato: 'amministrazione'
  };
  var FILTRI = ['tutto', 'accessi', 'problemi', 'richieste', 'amministrazione'];

  /** Scrive una riga. Da chiamare dentro Db.withLock. */
  function log(email, evento, esito, dispositivo, dettaglio, attore) {
    Db.insert('accessi', {
      ts: Util.nowIso(), email: Util.normEmail(email), evento: evento, esito: esito || 'ok',
      dispositivo: Util.text(dispositivo, 120), dettaglio: Util.text(dettaglio, 300), attore: Util.normEmail(attore)
    });
  }

  /** Come log, ma con il proprio blocco e senza mai far fallire l'operazione che sta registrando. */
  function logSafe(email, evento, esito, dispositivo, dettaglio, attore) {
    try {
      Db.withLock(function () { log(email, evento, esito, dispositivo, dettaglio, attore); });
    } catch (e) {
      console.error('CTRL log accessi non scritto', evento, e && e.message || e);
    }
  }

  function list(actor, p) {
    Users.require(actor, 'impostazioni');
    p = p || {};
    var filtro = FILTRI.indexOf(p.filtro) >= 0 ? p.filtro : 'tutto';
    var q = Util.text(p.q, 80).toLowerCase();
    var limite = Math.min(Math.max(parseInt(p.limite, 10) || 200, 1), MAX_RIGHE);
    var righe = Db.all('accessi')
      .filter(function (r) { return filtro === 'tutto' || CATEGORIE[r.evento] === filtro; })
      .filter(function (r) {
        return !q || (r.email + ' ' + r.attore + ' ' + r.dettaglio + ' ' + r.evento).toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b._row - a._row; });
    return {
      totale: righe.length,
      conserva_giorni: CONSERVA_GIORNI,
      righe: righe.slice(0, limite).map(function (r) {
        return {
          ts: r.ts, email: r.email, evento: r.evento, esito: r.esito, dispositivo: r.dispositivo,
          dettaglio: r.dettaglio, attore: r.attore, categoria: CATEGORIE[r.evento] || ''
        };
      })
    };
  }

  /** Cancella le righe oltre la conservazione e le richieste già chiuse da altrettanto tempo. */
  function purge() {
    var cutoff = Utilities.formatDate(new Date(Date.now() - CONSERVA_GIORNI * 86400000), CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss");
    return Db.withLock(function () {
      var log_ = Db.removeWhere('accessi', function (r) { return r.ts && r.ts < cutoff; });
      var req = Db.removeWhere('richieste_accesso', function (r) { return r.stato !== 'in_attesa' && r.gestita_il && r.gestita_il < cutoff; });
      return { accessi: log_, richieste: req };
    });
  }

  return { log: log, logSafe: logSafe, list: list, purge: purge, CATEGORIE: CATEGORIE };
})();

// ===== 14_Richieste.js =====
/**
 * CTRL · Richieste di accesso.
 *
 * Chi non ha un account può chiedere l'accesso dalla schermata di login. La risposta è sempre identica,
 * esista o no l'email, così nessuno scopre chi ha già un account. Non parte nessuna email alla persona:
 * quando il proprietario approva, la persona entra con il normale codice. Al proprietario arriva al più
 * una email di avviso all'ora, senza testo scritto da chi ha fatto la richiesta.
 * Limite globale: 3 richieste all'ora in totale, per non far riempire la tabella.
 */
var Richieste = (function () {
  var MAX_ALL_ORA = 3;
  var BLOCCO_RIFIUTO_GIORNI = 7;
  var MAX_GIORNI = 365;

  function cache() { return CacheService.getScriptCache(); }

  function crea(p) {
    var email = Util.normEmail(p && p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    var nome = Util.text(p.nome, 80);
    var messaggio = Util.text(p.messaggio, 300);

    var c = cache();
    var n = parseInt(c.get('accreq_ora') || '0', 10);
    if (n >= MAX_ALL_ORA) throw new CtrlError('RATE_LIMIT', 'Troppe richieste di accesso. Riprova tra un\'ora.');
    // il contatore sale per ogni chiamata, anche se l'email ha già un account: la risposta non rivela nulla
    c.put('accreq_ora', String(n + 1), 3600);

    var nuova = Db.withLock(function () {
      if (email === Users.adminEmail() || Users.byEmail(email)) return false;
      var blocco = Utilities.formatDate(new Date(Date.now() - BLOCCO_RIFIUTO_GIORNI * 86400000), CTRL_TZ, "yyyy-MM-dd'T'HH:mm:ss");
      var gia = Db.all('richieste_accesso').some(function (r) {
        return r.email === email && (r.stato === 'in_attesa' || (r.stato === 'rifiutata' && r.gestita_il > blocco));
      });
      if (gia) return false;
      Db.insert('richieste_accesso', {
        id: Util.newId('acc'), email: email, nome: nome, messaggio: messaggio, creata_il: Util.nowIso(), stato: 'in_attesa'
      });
      Accessi.log(email, 'richiesta', 'attesa', p.dispositivo, '', '');
      return true;
    });
    if (nuova) avvisaProprietario_();
    return { inviata: true };
  }

  function avvisaProprietario_() {
    var c = cache();
    if (c.get('accreq_mail')) return;
    c.put('accreq_mail', '1', 3600);
    try {
      MailApp.sendEmail({
        to: Users.adminEmail(),
        subject: 'CTRL · nuova richiesta di accesso',
        body: 'C\'è una nuova richiesta di accesso a CTRL.\nApri CTRL > Impostazioni > Richieste di accesso per approvarla o rifiutarla.\n' +
          'Altre richieste nell\'ora successiva non generano altre email.',
        name: 'CTRL'
      });
    } catch (e) {
      console.error('CTRL email di avviso non inviata', e && e.message || e);
    }
  }

  function lista(actor) {
    Users.require(actor, 'impostazioni');
    return Db.all('richieste_accesso')
      .filter(function (r) { return r.stato === 'in_attesa'; })
      .sort(function (a, b) { return a.creata_il < b.creata_il ? 1 : -1; })
      .map(function (r) { return { id: r.id, email: r.email, nome: r.nome, messaggio: r.messaggio, creata_il: r.creata_il }; });
  }

  function gestisci(actor, p) {
    Users.require(actor, 'impostazioni');
    var id = String(p.id || '');
    var azione = p.azione;
    if (azione !== 'approva' && azione !== 'rifiuta') throw new CtrlError('INVALID', 'Azione non valida');
    var req = Db.find('richieste_accesso', 'id', id);
    if (!req) throw new CtrlError('NOT_FOUND', 'Richiesta non trovata');
    if (req.stato !== 'in_attesa') throw new CtrlError('CONFLICT', 'Richiesta già gestita');

    if (azione === 'rifiuta') {
      return Db.withLock(function () {
        var r = Db.find('richieste_accesso', 'id', id);
        if (!r || r.stato !== 'in_attesa') throw new CtrlError('CONFLICT', 'Richiesta già gestita');
        Db.update('richieste_accesso', 'id', id, { stato: 'rifiutata', gestita_il: Util.nowIso(), gestita_da: actor.email });
        Accessi.log(r.email, 'richiesta_rifiutata', 'ko', '', '', actor.email);
        return { stato: 'rifiutata' };
      });
    }

    var ruolo = String(p.ruolo || '').toUpperCase();
    if (RUOLI_ASSEGNABILI.indexOf(ruolo) < 0) throw new CtrlError('INVALID', 'Ruolo non valido');
    var giorni = p.giorni === undefined || p.giorni === null || p.giorni === '' ? 0 : Number(p.giorni);
    if (!isFinite(giorni) || giorni < 0 || giorni > MAX_GIORNI || Math.floor(giorni) !== giorni) throw new CtrlError('INVALID', 'Durata non valida');
    var scade = giorni ? Util.addDays(Util.today(), giorni) : '';

    Users.save(actor, {
      email: req.email, nome: req.nome || req.email.split('@')[0], ruolo: ruolo, scade_il: scade
    });
    return Db.withLock(function () {
      Db.update('richieste_accesso', 'id', id, {
        stato: 'approvata', gestita_il: Util.nowIso(), gestita_da: actor.email, ruolo: ruolo, scade_il: scade
      });
      Accessi.log(req.email, 'richiesta_approvata', 'ok', '', Users.etichettaRuolo(ruolo) + (scade ? ' · fino al ' + scade : ''), actor.email);
      return { stato: 'approvata', email: req.email, ruolo: ruolo, scade_il: scade };
    });
  }

  return { crea: crea, lista: lista, gestisci: gestisci };
})();

// ===== 15_Staff.js =====
/**
 * CTRL · Staff assegnato agli eventi.
 *
 * - Un'assegnazione collega una persona (utente) a un evento. Solo l'OWNER assegna.
 * - Dalle descrizioni del Calendar nascono PROPOSTE: CTRL cerca nel testo il "nome in calendario" di ogni utente
 *   attivo (parola intera, senza maiuscole né accenti). Una proposta non vale nulla finché l'OWNER non la conferma.
 * - Le assegnazioni confermate o manuali non cambiano con la sincronizzazione. Una proposta scartata resta scartata.
 * - Chi non è assegnato vede l'evento ma non i suoi documenti: Production Plan, Material List, file e note.
 *   Per le produzioni con più eventi (festival) basta essere assegnati a uno degli eventi della produzione.
 *
 * stato: proposta · confermata · scartata (non è lui) · rimossa (tolta a mano) · decaduta (il nome non c'è più)
 */
var Staff = (function () {
  var FINESTRA_GIORNI = 30;
  var CONTESTO = 24;

  // ---------- ricerca dei nomi nel testo ----------
  function senzaAccenti(s) {
    var t = String(s || '');
    try { t = t.normalize('NFD'); } catch (e) { /* ambiente senza normalize */ }
    return t.replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** Parole del testo con la loro posizione: lettere e cifre latine, accentate comprese. */
  function parole(testo) {
    var out = [], re = /[A-Za-z0-9À-ɏ]+/g, m;
    while ((m = re.exec(testo)) !== null) out.push({ n: senzaAccenti(m[0]), start: m.index, end: m.index + m[0].length });
    return out;
  }

  /** Alias di un utente: "nome in calendario" separato da virgole; se vuoto, il primo nome (almeno 3 lettere). */
  function alias(u) {
    var elenco = String(u.nome_calendario || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!elenco.length) {
      var primo = String(u.nome || '').trim().split(/\s+/)[0];
      if (primo && senzaAccenti(primo).length >= 3) elenco = [primo];
    }
    return elenco.map(function (a) { return parole(a).map(function (w) { return w.n; }); })
      .filter(function (a) { return a.length && a.join('').length >= 2; });
  }

  function cerca(testoParole, aliasUtente) {
    for (var k = 0; k < aliasUtente.length; k++) {
      var a = aliasUtente[k];
      for (var i = 0; i + a.length <= testoParole.length; i++) {
        var ok = true;
        for (var j = 0; j < a.length; j++) if (testoParole[i + j].n !== a[j]) { ok = false; break; }
        if (ok) return { da: testoParole[i].start, a: testoParole[i + a.length - 1].end };
      }
    }
    return null;
  }

  function frammento(testo, da, a) {
    var s = Math.max(0, da - CONTESTO), e = Math.min(testo.length, a + CONTESTO);
    var f = testo.slice(s, e).replace(/\s+/g, ' ');
    var termine = testo.slice(da, a);
    return { trovato: Util.text((s > 0 ? '…' : '') + f + (e < testo.length ? '…' : ''), 160), termine: Util.text(termine, 80) };
  }

  /** Utenti che possono essere assegnati: attivi e non scaduti. */
  function utentiAttivi() {
    return Db.all('utenti').filter(function (u) {
      return !Util.bool(u.eliminato) && (Util.bool(u.attivo) || Util.normEmail(u.email) === Users.adminEmail()) && !Users.scaduto(u);
    });
  }

  function trovaNomi(e, attivi) {
    var out = {};
    var testo = String(e.descrizione || '');
    if (!testo) return out;
    var w = parole(testo);
    attivi.forEach(function (u) {
      var m = cerca(w, alias(u));
      if (m) out[Util.normEmail(u.email)] = frammento(testo, m.da, m.a);
    });
    return out;
  }

  function perEvento() {
    var out = {};
    Db.all('assegnazioni').forEach(function (r) {
      if (!out[r.evento_id]) out[r.evento_id] = {};
      out[r.evento_id][r.email] = r;
    });
    return out;
  }

  /**
   * Ricalcola le proposte di tutti gli eventi attivi recenti o futuri. Da chiamare dentro Db.withLock.
   * Non tocca assegnazioni confermate né proposte scartate.
   */
  function ricalcola_() {
    var da = Util.addDays(Util.today(), -FINESTRA_GIORNI);
    var attivi = utentiAttivi();
    var righe = perEvento();
    var stamp = Util.nowIso();
    var res = { nuove: 0, aggiornate: 0, decadute: 0 };
    Db.all('eventi').forEach(function (e) {
      if (e.stato !== 'attivo' || (e.data_fine || e.data) < da) return;
      var trovati = trovaNomi(e, attivi);
      var esistenti = righe[e.id] || {};
      Object.keys(trovati).forEach(function (email) {
        var t = trovati[email], r = esistenti[email];
        if (!r) {
          Db.insert('assegnazioni', { id: Util.newId('as'), evento_id: e.id, email: email, stato: 'proposta', origine: 'calendario',
            trovato: t.trovato, termine: t.termine, creata_il: stamp, creata_da: 'calendar', aggiornata_il: stamp, aggiornata_da: 'calendar' });
          Storico.log('calendar', e.id, 'staff', 'proposta', email, '', t.termine);
          res.nuove++;
        } else if (r.stato === 'proposta') {
          if (r.trovato !== t.trovato || r.termine !== t.termine) {
            Db.update('assegnazioni', 'id', r.id, { trovato: t.trovato, termine: t.termine, aggiornata_il: stamp, aggiornata_da: 'calendar' });
            res.aggiornate++;
          }
        } else if (r.stato === 'decaduta' || r.stato === 'rimossa') {
          Db.update('assegnazioni', 'id', r.id, { stato: 'proposta', origine: 'calendario', trovato: t.trovato, termine: t.termine,
            aggiornata_il: stamp, aggiornata_da: 'calendar' });
          Storico.log('calendar', e.id, 'staff', 'proposta', email, r.stato, t.termine);
          res.nuove++;
        }
      });
      Object.keys(esistenti).forEach(function (email) {
        var r = esistenti[email];
        if (r.stato === 'proposta' && !trovati[email]) {
          Db.update('assegnazioni', 'id', r.id, { stato: 'decaduta', aggiornata_il: stamp, aggiornata_da: 'calendar' });
          res.decadute++;
        }
      });
    });
    return res;
  }

  /** Come ricalcola_ ma senza mai far fallire l'operazione che lo chiama. Da chiamare dentro Db.withLock. */
  function ricalcolaSicuro_() {
    try { return ricalcola_(); }
    catch (e) { console.error('CTRL proposte staff non aggiornate', e && e.message || e); return null; }
  }

  // ---------- accesso ai documenti ----------
  /**
   * Cosa può vedere un utente: l'OWNER tutto; gli altri gli eventi a cui sono assegnati (confermati)
   * e quelli che condividono la stessa produzione.
   */
  function contesto(user) {
    if (!user || Users.can(user, 'admin')) return { tutto: true, vede: function () { return true; }, consente: function () { return true; }, produzione: function () { return true; } };
    // permesso particolare "vede tutti i documenti": accesso a ogni evento, ma non è l'Owner (niente proposte da confermare)
    var tuttiDoc = Users.can(user, 'vedereTutto');
    var mie = {}, prod = {};
    var eventi = {};
    Db.all('eventi').forEach(function (e) { eventi[e.id] = e; });
    Db.all('assegnazioni').forEach(function (r) {
      if (r.email !== Util.normEmail(user.email) || r.stato !== 'confermata') return;
      mie[r.evento_id] = true;
      var e = eventi[r.evento_id];
      if (e && e.progetto_id) prod[e.progetto_id] = true;
    });
    // chi ha solo lettura (VIEWER) vede soltanto gli eventi a cui è assegnato, passati compresi; Production e Owner tutti.
    // Il permesso "vede i documenti di tutti gli eventi" apre anche l'elenco.
    var limitato = Users.ruoloDi(user) === 'VIEWER' && !tuttiDoc;
    return {
      tutto: false,
      vede: function (e) { return !!(e && (!limitato || mie[e.id])); },
      assegnato: function (eventoId) { return !!mie[eventoId]; },
      consente: function (e) { return !!(e && (tuttiDoc || mie[e.id] || (e.progetto_id && prod[e.progetto_id]))); },
      produzione: function (pid) { return tuttiDoc || !!prod[pid]; }
    };
  }

  var MSG = 'Documenti, file e note sono riservati allo staff assegnato all\'evento';

  function puoAccedere(user, e) { return contesto(user).consente(e); }
  /** Può vedere l'evento (nome, data, luogo)? Il Viewer solo se assegnato. */
  function puoVedere(user, e) { return contesto(user).vede(e); }
  function richiediEvento(user, e) {
    if (!contesto(user).consente(e)) throw new CtrlError('FORBIDDEN', MSG);
  }
  function richiediProduzione(user, pid) {
    if (!contesto(user).produzione(String(pid || ''))) throw new CtrlError('FORBIDDEN', MSG);
  }

  // ---------- vista per le liste di eventi ----------
  function nomeDi(u) {
    if (Util.normEmail(u.email) === Users.adminEmail()) return Users.nomeOwner(u.nome);
    return String(u.nome || '').trim() || String(u.email || '').split('@')[0];
  }

  /** Strumenti per costruire la lista eventi con una sola lettura delle tabelle. */
  function perLista(user) {
    var ctx = contesto(user);
    var owner = ctx.tutto;
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var conf = {}, prop = {};
    Db.all('assegnazioni').forEach(function (r) {
      if (r.stato === 'confermata') (conf[r.evento_id] = conf[r.evento_id] || []).push(r);
      else if (r.stato === 'proposta') prop[r.evento_id] = (prop[r.evento_id] || 0) + 1;
    });
    var mia = Util.normEmail(user && user.email);
    return {
      accesso: function (e) { return ctx.consente(e); },
      vede: function (e) { return ctx.vede(e); },
      staff: function (eventoId) {
        return (conf[eventoId] || []).slice().sort(function (a, b) { return a.aggiornata_il < b.aggiornata_il ? -1 : a.aggiornata_il > b.aggiornata_il ? 1 : 0; })
          .map(function (r) {
            var u = utenti[r.email] || { email: r.email, nome: '' };
            return { id: u.id || '', nome: nomeDi(u), colore: Users.coloreDi(u) };
          });
      },
      mio: function (eventoId) { return (conf[eventoId] || []).some(function (r) { return r.email === mia; }); },
      daConfermare: function (eventoId) { return owner ? (prop[eventoId] || 0) : 0; }
    };
  }

  // ---------- azioni dell'OWNER ----------
  function vistaPersona(r, u) {
    u = u || { email: r.email, nome: '', ruolo: 'VIEWER' };
    return { email: r.email, nome: u.nome || r.email, ruolo: Users.ruoloDi(u), colore: Users.coloreDi(u),
      origine: r.origine, trovato: r.trovato, termine: r.termine, stato: r.stato };
  }

  function evento_(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  /** Staff di un evento per la scheda "Staff" (solo OWNER). */
  function lista(actor, p) {
    Users.require(actor, 'impostazioni');
    var e = evento_(p && p.evento_id);
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var righe = Db.all('assegnazioni').filter(function (r) { return r.evento_id === e.id; })
      .sort(function (a, b) { return a.creata_il < b.creata_il ? -1 : 1; });
    var per = function (stato) {
      return righe.filter(function (r) { return r.stato === stato; }).map(function (r) { return vistaPersona(r, utenti[r.email]); });
    };
    var assegnati = per('confermata');
    var presi = {};
    assegnati.forEach(function (a) { presi[a.email] = true; });
    var candidati = utentiAttivi().filter(function (u) { return !presi[Util.normEmail(u.email)]; })
      .map(function (u) { return { email: u.email, nome: u.nome || u.email, ruolo: Users.ruoloDi(u), colore: Users.coloreDi(u) }; })
      .sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1; });
    return { evento_id: e.id, assegnati: assegnati, proposte: per('proposta'), scartate: per('scartata'), candidati: candidati };
  }

  var AZIONI = ['conferma', 'scarta', 'rimuovi', 'ripristina', 'aggiungi'];

  function gestisci(actor, p) {
    Users.require(actor, 'impostazioni');
    p = p || {};
    var azione = String(p.azione || '');
    if (AZIONI.indexOf(azione) < 0) throw new CtrlError('INVALID', 'Azione non valida');
    var email = Util.normEmail(p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    var e = evento_(p.evento_id);
    Db.withLock(function () {
      var riga = (perEvento()[e.id] || {})[email] || null;
      var u = Db.find('utenti', 'email', email);
      var stamp = Util.nowIso();
      var scrivi = function (patch, prima) {
        patch.aggiornata_il = stamp; patch.aggiornata_da = actor.email;
        Db.update('assegnazioni', 'id', riga.id, patch);
        Storico.log(actor.email, e.id, 'staff', azione, email, prima, patch.stato);
      };
      if (azione === 'aggiungi') {
        if (!u || !utentiAttivi().some(function (x) { return Util.normEmail(x.email) === email; })) throw new CtrlError('INVALID', 'Utente non attivo');
        if (riga && riga.stato === 'confermata') return;
        if (riga) scrivi({ stato: 'confermata', origine: 'manuale' }, riga.stato);
        else {
          Db.insert('assegnazioni', { id: Util.newId('as'), evento_id: e.id, email: email, stato: 'confermata', origine: 'manuale',
            creata_il: stamp, creata_da: actor.email, aggiornata_il: stamp, aggiornata_da: actor.email });
          Storico.log(actor.email, e.id, 'staff', 'aggiungi', email, '', 'confermata');
        }
        return;
      }
      if (!riga) throw new CtrlError('NOT_FOUND', 'Assegnazione non trovata');
      if (azione === 'conferma') {
        if (riga.stato !== 'proposta') throw new CtrlError('CONFLICT', 'La proposta non è più in attesa');
        scrivi({ stato: 'confermata' }, riga.stato);
      } else if (azione === 'scarta') {
        if (riga.stato !== 'proposta') throw new CtrlError('CONFLICT', 'La proposta non è più in attesa');
        scrivi({ stato: 'scartata' }, riga.stato);
      } else if (azione === 'rimuovi') {
        if (riga.stato !== 'confermata') throw new CtrlError('CONFLICT', 'La persona non è assegnata');
        // se veniva dal Calendar si ricorda che non era lei, altrimenti la prossima sync la riproporrebbe
        scrivi({ stato: riga.origine === 'calendario' ? 'scartata' : 'rimossa' }, riga.stato);
      } else if (azione === 'ripristina') {
        if (riga.stato !== 'scartata') throw new CtrlError('CONFLICT', 'Niente da ripristinare');
        var trovati = u ? trovaNomi(e, [u]) : {};
        if (!trovati[email]) throw new CtrlError('INVALID', 'Il nome non è più nella descrizione dell\'evento');
        scrivi({ stato: 'proposta', trovato: trovati[email].trovato, termine: trovati[email].termine }, riga.stato);
      }
    });
    return lista(actor, { evento_id: e.id });
  }

  return {
    ricalcola_: ricalcola_, ricalcolaSicuro_: ricalcolaSicuro_, contesto: contesto, puoAccedere: puoAccedere, puoVedere: puoVedere,
    richiediEvento: richiediEvento, richiediProduzione: richiediProduzione, perLista: perLista,
    lista: lista, gestisci: gestisci, alias: alias, MSG: MSG
  };
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

  function view(e, conteggi, user, st) {
    var c = conteggi[e.id] || { piano: 0, materiale: 0, scheda: 0 };
    var accesso = st.accesso(e);
    var v = {
      id: e.id, origine: e.origine, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data,
      ora_inizio: e.ora_inizio, ora_fine: e.ora_fine, luogo: e.luogo, descrizione: e.descrizione,
      colore: e.colore || COLORE_DEFAULT, stato: e.stato, note: accesso ? e.note : '', versione: e.versione,
      aggiornato_il: e.aggiornato_il, aggiornato_da: e.aggiornato_da, produzione_id: e.progetto_id || '',
      stato_doc: { piano: c.piano > 0, materiale: c.materiale > 0, scheda: c.scheda > 0 },
      staff: st.staff(e.id), mio: st.mio(e.id), accesso: accesso, da_confermare: st.daConfermare(e.id)
    };
    if (user && Users.can(user, 'admin') && e.cartella_id) v.cartella_url = 'https://drive.google.com/drive/folders/' + e.cartella_id;
    return v;
  }

  function list(user, p) {
    var conteggi = contaSezioni();
    var st = Staff.perLista(user);
    var includiArchiviati = !!(p && p.archiviati);
    return Db.all('eventi')
      .filter(function (e) { return includiArchiviati || e.stato !== 'archiviato'; })
      .filter(function (e) { return st.vede(e); })
      .map(function (e) { return view(e, conteggi, user, st); })
      .sort(function (a, b) {
        var ka = a.data + (a.ora_inizio || '99:99') + a.titolo;
        var kb = b.data + (b.ora_inizio || '99:99') + b.titolo;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
  }

  function get(user, p) {
    var e = Db.find('eventi', 'id', p && p.id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var st = Staff.perLista(user);
    // chi non può vedere l'evento riceve la stessa risposta di un evento che non esiste
    if (!st.vede(e)) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var out = view(e, contaSezioni(), user, st);
    // chi non è nello staff vede l'evento ma non file, documenti e note
    out.allegati = out.accesso ? Allegati.perEvento(e.id) : null;
    out.produzione = out.accesso && e.progetto_id ? Produzioni.riepilogo(e.progetto_id) : null;
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
      Staff.ricalcolaSicuro_();
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
      Staff.richiediEvento(user, e);
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
      if (patch.descrizione !== undefined) Staff.ricalcolaSicuro_();
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

      // le descrizioni cambiate possono nominare persone dello staff: nascono (o decadono) le proposte
      var prop = Staff.ricalcolaSicuro_();
      if (prop) res.proposte = prop.nuove;

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
      Staff.richiediEvento(user, e);
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
    Staff.richiediEvento(user, evento(a.evento_id));
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
      Staff.richiediEvento(user, evento(a.evento_id));
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
      Staff.richiediEvento(user, e);
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
      Staff.richiediProduzione(user, pr.id);
      Staff.richiediEvento(user, e);
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
      Staff.richiediProduzione(user, pr.id);
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
    Staff.richiediProduzione(user, pr.id);
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
    Staff.richiediProduzione(user, pr.id);
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
    Staff.richiediProduzione(user, pr.id);
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
  'accesso.richiedi': { pub: true, fn: function (u, p) { return Richieste.crea(p); } },
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
  'utenti.save': { fn: function (u, p) { return Users.save(u, p); } },
  'utenti.elimina': { fn: function (u, p) { return Users.elimina(u, p); } },
  'utenti.proroga': { fn: function (u, p) { return Users.proroga(u, p); } },
  'utenti.sessioni': { fn: function (u, p) { Users.require(u, 'impostazioni'); return Auth.sessionsOf(Util.normEmail(p.email)); } },
  'utenti.disconnetti': { fn: function (u, p) { Users.require(u, 'impostazioni'); return Auth.revoke(u, Util.normEmail(p.email), p.id); } },

  'staff.evento': { fn: function (u, p) { return Staff.lista(u, p); } },
  'staff.gestisci': { fn: function (u, p) { return Staff.gestisci(u, p); } },

  'accesso.richieste': { fn: function (u) { return Richieste.lista(u); } },
  'accesso.gestisci': { fn: function (u, p) { return Richieste.gestisci(u, p); } },
  'accessi.list': { fn: function (u, p) { return Accessi.list(u, p); } }
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
      id: Util.newId('usr'), email: props.ADMIN_EMAIL, nome: Users.nomeOwner(''), ruolo: 'OWNER', puo_caricare: 'TRUE',
      puo_modificare: 'TRUE', attivo: 'TRUE', creato_il: Util.nowIso(), aggiornato_il: Util.nowIso(), versione: '1'
    });
    log.push('Creato proprietario ' + props.ADMIN_EMAIL);
  }
  migraRuoli_(log);
  migraColori_(log);
  migraNomeOwner_(log);
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

/** Dà un colore a chi non ne ha ancora (il meno usato). Idempotente: non cambia i colori già assegnati. */
function migraColori_(log) {
  Db.clearCache();
  Db.all('utenti').forEach(function (u) {
    if (COLORI_UTENTE.indexOf(u.colore) >= 0) return;
    var c = Users.scegliColore(Util.normEmail(u.email));
    Db.update('utenti', 'email', u.email, { colore: c }, null, true);
    log.push('Colore ' + u.email + ': ' + c);
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

/** Ogni notte: sessioni scadute, accessi scaduti, registro oltre 180 giorni. */
function puliziaNotturna() {
  return { sessioni: Auth.purgeExpired(), scaduti: Auth.closeExpiredUsers(), registro: Accessi.purge() };
}

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

/** Il proprietario si chiama col suo nome (non "Admin" o "Owner"): lo vedono anche gli altri tecnici. Idempotente. */
function migraNomeOwner_(log) {
  Db.clearCache();
  var u = Db.find('utenti', 'email', Util.normEmail(Users.adminEmail()));
  if (!u) return;
  var nome = Users.nomeOwner(u.nome);
  if (nome === String(u.nome || '').trim()) return;
  Db.update('utenti', 'email', u.email, { nome: nome, aggiornato_il: Util.nowIso() }, null, true);
  log.push('Nome del proprietario: ' + nome);
}
