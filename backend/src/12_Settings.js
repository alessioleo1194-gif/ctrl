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
