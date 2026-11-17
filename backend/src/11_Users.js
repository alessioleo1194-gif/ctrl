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
