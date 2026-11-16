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
