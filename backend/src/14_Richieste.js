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
