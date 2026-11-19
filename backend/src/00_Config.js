/**
 * CTRL · Configurazione dell'ambiente.
 *
 * Gli ID di Drive e Calendar NON sono scritti nel codice: vivono nelle
 * Proprietà dello script (Impostazioni progetto > Proprietà script),
 * impostate una sola volta dalle funzioni setupProduzione() / setupTest()
 * in 90_Setup.js.
 */
var CTRL_VERSION = '0.13.2';
var CTRL_TZ = 'Europe/Rome';

var Config = (function () {
  var cache = null;

  function all() {
    if (!cache) cache = PropertiesService.getScriptProperties().getProperties();
    return cache;
  }

  function get(key, fallback) {
    var v = all()[key];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  function require_(key) {
    var v = get(key);
    if (!v) throw new CtrlError('SERVER', 'Configurazione mancante: ' + key + '. Esegui la funzione di setup.');
    return v;
  }

  function setAll(obj) {
    PropertiesService.getScriptProperties().setProperties(obj, false);
    cache = null;
  }

  function reset() {
    cache = null;
  }

  return { get: get, require: require_, setAll: setAll, reset: reset };
})();
