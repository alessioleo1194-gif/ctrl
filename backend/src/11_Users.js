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
