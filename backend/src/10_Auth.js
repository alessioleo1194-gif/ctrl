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
