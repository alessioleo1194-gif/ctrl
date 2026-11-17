/**
 * CTRL · Installazione e manutenzione automatica.
 *
 * Da eseguire UNA volta dall'editor Apps Script (menu "Esegui"):
 *   - setupProduzione()  nel progetto "CTRL API"
 *   - setupTest()        nel progetto "CTRL API TEST"
 * Sono idempotenti: rieseguirle non cancella dati, aggiunge solo ciò che manca.
 */
var ENVIRONMENTS = {
  prod: {
    ENV: 'prod',
    DB_ID: '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I',
    EVENTI_ID: '1tm4vwnFy7DuOI7WKOhBwO-5V8e58njld',
    FESTIVAL_ID: '10DavyTdm5PDRGJoFzHgJqJjNydEw_DQM',
    BACKUP_ID: '1Dpcp7dkr_KGV6t_yYPNxJAkjjLt7-l1H',
    CALENDAR_ID: 's0qardtva2jj8r09ihdl0gh1qc@group.calendar.google.com'
  },
  test: {
    ENV: 'test',
    DB_ID: '1LGIPUlgNmDBmDX5HkJ3r_67IMnd_zeoRGhZxdNQe-bM',
    EVENTI_ID: '17x8B43it-ZGY9XAk5J2RswHak-UGL_aI',
    FESTIVAL_ID: '1qFvBZKd8V2Wv6VISeC_KmHnx6U9Hfqc0',
    BACKUP_ID: '1spPomhPXAVE41odgK1aAkCi56fNDZmCm',
    // Il test legge lo stesso calendario (sola lettura): i dati scritti restano nel database di test.
    CALENDAR_ID: 's0qardtva2jj8r09ihdl0gh1qc@group.calendar.google.com'
  }
};

function setupProduzione() { return setup_('prod'); }
function setupTest() { return setup_('test'); }

function setup_(env) {
  var conf = ENVIRONMENTS[env];
  var admin = Session.getEffectiveUser().getEmail();
  var props = {};
  Object.keys(conf).forEach(function (k) { props[k] = conf[k]; });
  props.ADMIN_EMAIL = Util.normEmail(admin);
  Config.setAll(props);
  Db.clearCache();

  var log = [];
  var ss = SpreadsheetApp.openById(conf.DB_ID);
  ss.setSpreadsheetTimeZone(CTRL_TZ);
  log.push('Fuso orario del foglio: ' + CTRL_TZ);

  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      log.push('Creata tabella ' + name);
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    var added = [];
    cols.forEach(function (c) {
      if (head.indexOf(c) < 0) {
        var pos = head.filter(function (h) { return h; }).length + 1;
        sh.getRange(1, pos).setValue(c);
        head[pos - 1] = c;
        added.push(c);
      }
    });
    if (added.length) log.push(name + ': aggiunte colonne ' + added.join(', '));
    var width = head.filter(function (h) { return h; }).length;
    sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');
    sh.getRange(1, 1, 1, width).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  // Rimuove il foglio iniziale vuoto creato con il file.
  // Il nome si legge prima di eliminare: dopo deleteSheet il foglio non è più utilizzabile.
  ss.getSheets().forEach(function (sh) {
    var nome = sh.getName();
    if (!SCHEMA[nome] && ss.getSheets().length > 1 && sh.getLastRow() <= 2) {
      ss.deleteSheet(sh);
      log.push('Rimosso foglio iniziale ' + nome);
    }
  });

  Db.clearCache();
  if (!Db.find('utenti', 'email', props.ADMIN_EMAIL)) {
    Db.insert('utenti', {
      id: Util.newId('usr'), email: props.ADMIN_EMAIL, nome: 'Admin', ruolo: 'OWNER', puo_caricare: 'TRUE',
      puo_modificare: 'TRUE', attivo: 'TRUE', creato_il: Util.nowIso(), aggiornato_il: Util.nowIso(), versione: '1'
    });
    log.push('Creato proprietario ' + props.ADMIN_EMAIL);
  }
  migraRuoli_(log);
  if (!Settings.getRaw('schema_versione')) Settings.setRaw('schema_versione', String(SCHEMA_VERSION));

  installTriggers_();
  log.push('Attività automatiche: sincronizzazione ogni ora, backup ogni lunedì, pulizia sessioni ogni notte');

  var res = CalendarSync.run('setup');
  log.push('Prima sincronizzazione: ' + JSON.stringify(res));

  console.log(log.join('\n'));
  return log;
}

/**
 * Riscrive i ruoli vecchi (ADMIN, COLLABORATORE, LETTURA) in OWNER / PRODUCTION / VIEWER.
 * Idempotente. Chi perde permessi (altri ADMIN) viene disconnesso. Il proprietario è solo ADMIN_EMAIL.
 */
function migraRuoli_(log) {
  Db.clearCache();
  Db.all('utenti').forEach(function (u) {
    var nuovo = Users.ruoloDi(u);
    var daScrivere = u.ruolo !== nuovo;
    if (!daScrivere) return;
    var prima = JSON.parse(JSON.stringify(u));
    var rw = nuovo === 'VIEWER' ? 'FALSE' : 'TRUE';
    Db.update('utenti', 'email', u.email, { ruolo: nuovo, puo_caricare: rw, puo_modificare: rw, aggiornato_il: Util.nowIso() });
    Storico.log('setup', '', 'utenti', 'ruolo_migrato', u.email, prima.ruolo, nuovo);
    if (String(prima.ruolo).toUpperCase() === 'ADMIN' && nuovo !== 'OWNER') Auth.revokeAll(u.email);
    log.push('Ruolo ' + u.email + ': ' + prima.ruolo + ' → ' + nuovo);
  });
}

function installTriggers_() {
  var wanted = { syncOraria: true, backupSettimanale: true, puliziaNotturna: true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncOraria').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('backupSettimanale').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();
  ScriptApp.newTrigger('puliziaNotturna').timeBased().everyDays(1).atHour(3).create();
}

/** Attività automatiche (trigger). */
function syncOraria() {
  try { CalendarSync.run(''); }
  catch (e) { Settings.setRaw('sync_esito', { errore: String(e.message || e) }); throw e; }
}

function backupSettimanale() { return Backup.run(); }

function puliziaNotturna() { return Auth.purgeExpired(); }

var Backup = (function () {
  var KEEP = 8;
  function run() {
    var folder = DriveApp.getFolderById(Config.require('BACKUP_ID'));
    var src = DriveApp.getFileById(Config.require('DB_ID'));
    var name = 'CTRL backup ' + Utilities.formatDate(new Date(), CTRL_TZ, 'yyyy-MM-dd HH.mm');
    src.makeCopy(name, folder);
    var files = [];
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf('CTRL backup ') === 0) files.push(f);
    }
    files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    files.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
    return { creato: name, conservati: Math.min(files.length, KEEP) };
  }
  return { run: run };
})();
