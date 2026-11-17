/**
 * CTRL · Utenti e permessi.
 *
 * Ruoli:
 * - OWNER: tutto. È solo l'email in ADMIN_EMAIL (proprietà dello script) e resta tale anche se il foglio viene modificato.
 *   Non si assegna dal portale: nessun altro può diventarlo.
 * - PRODUCTION: vede tutto, scarica i PDF, carica file, crea e modifica Production Plan e Material List.
 * - VIEWER: vede e scarica, non modifica nulla.
 * Ogni utente (tranne il proprietario) può avere una scadenza: scade_il è l'ultimo giorno di accesso (ora italiana).
 * Dal giorno dopo l'accesso è rifiutato e le sessioni vengono chiuse. Una data non valida nel foglio vale "scaduto".
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

  var ETICHETTE = { OWNER: 'Owner', PRODUCTION: 'Production', VIEWER: 'Viewer' };
  function etichettaRuolo(r) { return ETICHETTE[r] || r; }

  /** True se l'accesso è oltre la scadenza. Il proprietario non scade mai. */
  function scaduto(u) {
    if (!u || ruoloDi(u) === 'OWNER') return false;
    var s = u.scade_il;
    if (!s) return false;
    return !Util.isDate(s) || Util.today() > s;
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
      if (Util.normEmail(u.email) === escludiEmail) return;
      if (usi.hasOwnProperty(u.colore)) usi[u.colore]++;
    });
    return COLORI_UTENTE.slice().sort(function (a, b) { return usi[a] - usi[b] || COLORI_UTENTE.indexOf(a) - COLORI_UTENTE.indexOf(b); })[0];
  }

  function publicProfile(u) {
    return { id: u.id || '', email: u.email, nome: u.nome || u.email, ruolo: u.ruolo, colore: coloreDi(u), permessi: perms(u) };
  }

  function touchLogin(email) {
    var u = Db.find('utenti', 'email', email);
    if (u) Db.update('utenti', 'email', email, { ultimo_accesso: Util.nowIso() });
  }

  function list(actor) {
    require_(actor, 'impostazioni');
    var now = Util.nowIso();
    var sessioni = {};
    Db.all('sessioni').forEach(function (x) { if (x.scade >= now) sessioni[x.email] = (sessioni[x.email] || 0) + 1; });
    var oggi = Util.today();
    return Db.all('utenti').map(function (u) {
      var owner = ruoloDi(u) === 'OWNER';
      var scade = owner ? '' : (u.scade_il || '');
      var valida = Util.isDate(scade);
      return {
        id: u.id, email: u.email, nome: u.nome, ruolo: ruoloDi(u),
        attivo: Util.bool(u.attivo) || u.email === adminEmail(), ultimo_accesso: u.ultimo_accesso, versione: u.versione,
        protetto: u.email === adminEmail(),
        scade_il: scade, scaduto: scaduto(u), giorni_rimasti: valida && !scaduto(u) ? Util.diffDays(oggi, scade) : null,
        sessioni: sessioni[u.email] || 0,
        nome_calendario: u.nome_calendario || '', colore: coloreDi(u)
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
    if (p.nome_calendario !== undefined) fields.nome_calendario = Util.text(p.nome_calendario, 200);
    if (colore) fields.colore = colore;
    return Db.withLock(function () {
      var existing = Db.find('utenti', 'email', email);
      var out;
      if (existing) {
        var before = JSON.parse(JSON.stringify(existing));
        out = Db.update('utenti', 'email', email, fields, p.versione);
        if (!out.colore && !fields.colore) { out = Db.update('utenti', 'email', email, { colore: scegliColore(email) }, null, true); }
        var d = Storico.diff(before, out, ['nome', 'ruolo', 'attivo', 'scade_il', 'nome_calendario', 'colore']);
        if (d.changed) Storico.log(actor.email, '', 'utenti', 'modifica', email, d.prima, d.dopo);
        var lostAccess = before.attivo !== out.attivo && out.attivo === 'FALSE';
        var demoted = ruoloDi(before) !== ruoloDi(out);
        if (lostAccess || demoted) Auth.revokeAll(email);
        if (demoted) Accessi.log(email, 'ruolo', 'ok', '', etichettaRuolo(ruoloDi(before)) + ' → ' + etichettaRuolo(ruoloDi(out)), actor.email);
        if ((before.scade_il || '') !== (out.scade_il || '')) {
          Accessi.log(email, 'scadenza', 'ok', '', (before.scade_il || 'nessuna') + ' → ' + (out.scade_il || 'nessuna'), actor.email);
        }
        if (lostAccess) Accessi.log(email, 'disattivato', 'ok', '', '', actor.email);
        else if (before.attivo === 'FALSE' && out.attivo === 'TRUE') Accessi.log(email, 'riattivato', 'ok', '', '', actor.email);
      } else {
        fields.id = Util.newId('usr');
        if (!fields.colore) fields.colore = scegliColore('');
        fields.creato_il = Util.nowIso();
        fields.versione = '1';
        out = Db.insert('utenti', fields);
        Storico.log(actor.email, '', 'utenti', 'crea', email, '', { ruolo: ruolo });
        Accessi.log(email, 'utente_creato', 'ok', '', etichettaRuolo(ruolo) + (out.scade_il ? ' · fino al ' + out.scade_il : ''), actor.email);
      }
      // nome, alias o stato possono cambiare chi viene trovato nelle descrizioni
      Staff.ricalcolaSicuro_();
      return { email: out.email, versione: out.versione };
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
    touchLogin: touchLogin, list: list, save: save, adminEmail: adminEmail, coloreDi: coloreDi, scegliColore: scegliColore
  };
})();
