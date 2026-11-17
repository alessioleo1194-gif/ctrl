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
