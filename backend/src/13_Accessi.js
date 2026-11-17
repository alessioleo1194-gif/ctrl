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
    disattivato: 'amministrazione', riattivato: 'amministrazione', disconnessione: 'amministrazione'
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
