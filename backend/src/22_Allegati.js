/**
 * CTRL · File allegati a un evento (rider, PdP già pronti, foto), salvati su Drive
 * nella cartella dell'evento e raggruppati per sezione: piano, materiale, scheda.
 *
 * Righe e testo libero della Fase 2 sono stati sostituiti dalla scheda di produzione
 * (23_Produzioni.js); restano solo i file.
 */
var Allegati = (function () {
  var SEZIONI = ['piano', 'materiale', 'scheda'];
  var MAX_BYTE = 20 * 1024 * 1024; // limite prudente per Apps Script (corpo della richiesta in base64)

  function sezione(s) {
    if (SEZIONI.indexOf(s) < 0) throw new CtrlError('INVALID', 'Sezione sconosciuta');
    return s;
  }

  function evento(id) {
    var e = Db.find('eventi', 'id', id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  function lista(eventoId, sez) {
    return Db.all('allegati')
      .filter(function (r) { return r.evento_id === eventoId && r.sezione === sez && !Util.bool(r.nel_cestino); })
      .sort(function (a, b) { return a.caricato_il < b.caricato_il ? -1 : 1; })
      .map(function (r) {
        return { id: r.id, nome: r.nome, mime: r.mime, byte: parseInt(r.byte, 10) || 0, caricato_da: r.caricato_da, caricato_il: r.caricato_il };
      });
  }

  /** File dell'evento per sezione (inclusi nella risposta di eventi.get). */
  function perEvento(eventoId) {
    var out = {};
    SEZIONI.forEach(function (s) { out[s] = lista(eventoId, s); });
    return out;
  }

  function nomeCartella(e) {
    var t = String(e.titolo || 'Evento').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return e.data + ' · ' + t;
  }

  /** Cartella Drive dell'evento, creata al primo caricamento. Da chiamare dentro Db.withLock. */
  function cartella(e) {
    if (e.cartella_id) {
      try { return DriveApp.getFolderById(e.cartella_id); } catch (err) { /* cartella rimossa: se ne crea una nuova */ }
    }
    var padre = DriveApp.getFolderById(Config.require('EVENTI_ID'));
    var f = padre.createFolder(nomeCartella(e));
    Db.update('eventi', 'id', e.id, { cartella_id: f.getId() }, null, true);
    return f;
  }

  function carica(user, p) {
    Users.require(user, 'caricare');
    p = p || {};
    sezione(p.sezione);
    var nome = Util.text(p.nome, 150).replace(/[\\/]+/g, '-');
    if (!nome) throw new CtrlError('INVALID', 'Nome del file mancante');
    if (typeof p.dati !== 'string' || !p.dati) throw new CtrlError('INVALID', 'File vuoto');
    if (p.dati.length > Math.ceil(MAX_BYTE / 3) * 4 + 4) throw new CtrlError('TOO_LARGE', 'File troppo grande (massimo 20 MB)');
    var mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(p.mime || '')) ? String(p.mime) : 'application/octet-stream';
    var bytes;
    try { bytes = Utilities.base64Decode(p.dati); } catch (err) { throw new CtrlError('INVALID', 'File non leggibile'); }
    if (!bytes.length) throw new CtrlError('INVALID', 'File vuoto');
    if (bytes.length > MAX_BYTE) throw new CtrlError('TOO_LARGE', 'File troppo grande (massimo 20 MB)');

    return Db.withLock(function () {
      var e = evento(p.evento_id);
      var file = cartella(e).createFile(Utilities.newBlob(bytes, mime, nome));
      var row = Db.insert('allegati', {
        id: Util.newId('al'), evento_id: e.id, sezione: p.sezione, drive_id: file.getId(), nome: nome, mime: mime,
        byte: String(bytes.length), caricato_da: user.email, caricato_il: Util.nowIso(), nel_cestino: 'FALSE'
      });
      Storico.log(user.email, e.id, p.sezione, 'allegato', row.id, '', nome);
      return { sezione: p.sezione, allegati: lista(e.id, p.sezione) };
    });
  }

  function trovaAllegato(id) {
    var a = Db.find('allegati', 'id', id);
    if (!a || Util.bool(a.nel_cestino)) throw new CtrlError('NOT_FOUND', 'File non trovato');
    return a;
  }

  function scarica(user, p) {
    var a = trovaAllegato(p && p.id);
    var file;
    try { file = DriveApp.getFileById(a.drive_id); } catch (err) { throw new CtrlError('NOT_FOUND', 'Il file non è più su Drive'); }
    if (file.isTrashed && file.isTrashed()) throw new CtrlError('NOT_FOUND', 'Il file è nel cestino di Drive');
    return { nome: a.nome, mime: a.mime, dati: Utilities.base64Encode(file.getBlob().getBytes()) };
  }

  /** Sposta il file nel cestino di Drive (recuperabile per 30 giorni). Admin o chi l'ha caricato. */
  function elimina(user, p) {
    Users.require(user, 'caricare');
    return Db.withLock(function () {
      var a = trovaAllegato(p && p.id);
      if (!Users.can(user, 'admin') && a.caricato_da !== user.email) {
        throw new CtrlError('FORBIDDEN', 'Puoi togliere solo i file che hai caricato tu');
      }
      try { DriveApp.getFileById(a.drive_id).setTrashed(true); } catch (err) { /* già rimosso da Drive */ }
      Db.update('allegati', 'id', a.id, { nel_cestino: 'TRUE' });
      Storico.log(user.email, a.evento_id, a.sezione, 'allegato_tolto', a.id, a.nome, '');
      return { sezione: a.sezione, allegati: lista(a.evento_id, a.sezione) };
    });
  }

  return { SEZIONI: SEZIONI, MAX_BYTE: MAX_BYTE, perEvento: perEvento, carica: carica, scarica: scarica, elimina: elimina };
})();
