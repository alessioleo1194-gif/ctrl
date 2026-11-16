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

  'allegati.carica': { fn: function (u, p) { return Allegati.carica(u, p); } },
  'allegati.scarica': { fn: function (u, p) { return Allegati.scarica(u, p); } },
  'allegati.elimina': { fn: function (u, p) { return Allegati.elimina(u, p); } },

  'produzione.get': { fn: function (u, p) { return Produzioni.get(u, p); } },
  'produzione.crea': { fn: function (u, p) { return Produzioni.crea(u, p); } },
  'produzione.collega': { fn: function (u, p) { return Produzioni.collega(u, p); } },
  'produzione.scollega': { fn: function (u, p) { return Produzioni.scollega(u, p); } },
  'produzione.salva': { fn: function (u, p) { return Produzioni.salva(u, p); } },
  'persone.list': { fn: function (u) { return Produzioni.rubrica(u); } },
  'persone.elimina': { fn: function (u, p) { return Produzioni.eliminaPersona(u, p); } },

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
