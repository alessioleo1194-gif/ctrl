/**
 * CTRL · Sezioni di produzione di un evento: piano, materiale, scheda tecnica.
 *
 * Ogni sezione si compila in tre modi, anche insieme:
 * - righe strutturate (tabelle attivita / materiale / canali);
 * - testo libero (tabella testi, una riga per evento e sezione);
 * - file allegati, salvati su Drive nella cartella dell'evento (tabella allegati).
 *
 * La riga in "testi" fa anche da intestazione della sezione: il suo campo versione
 * cambia a ogni salvataggio di righe o testo, così due persone che modificano la
 * stessa sezione non si sovrascrivono (CONFLICT).
 */
var Sezioni = (function () {
  var DEF = {
    piano: {
      tabella: 'attivita', obbligatorio: 'attivita', nome: 'Piano di produzione',
      campi: { ora_inizio: 5, ora_fine: 5, attivita: 200, responsabile: 120, note: 500 },
      orari: ['ora_inizio', 'ora_fine']
    },
    materiale: {
      tabella: 'materiale', obbligatorio: 'voce', nome: 'Lista materiale',
      campi: { voce: 200, quantita: 20, area: 60, provenienza: 60, note: 500 }
    },
    scheda: {
      tabella: 'canali', obbligatorio: 'sorgente', nome: 'Scheda tecnica',
      campi: { numero: 10, sorgente: 120, microfono: 120, di: 60, asta: 60, note: 500 }
    }
  };
  var MAX_RIGHE = 300;
  var MAX_TESTO = 20000;
  var MAX_BYTE = 20 * 1024 * 1024; // limite prudente per Apps Script (corpo della richiesta in base64)

  function def(sezione) {
    var d = DEF[sezione];
    if (!d) throw new CtrlError('INVALID', 'Sezione sconosciuta');
    return d;
  }

  function evento(id) {
    var e = Db.find('eventi', 'id', id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  function testata(eventoId, sezione) {
    var rows = Db.all('testi').filter(function (r) { return r.evento_id === eventoId && r.sezione === sezione; });
    return rows.length ? rows[0] : null;
  }

  function righe(eventoId, sezione) {
    var d = def(sezione);
    return Db.all(d.tabella)
      .filter(function (r) { return r.evento_id === eventoId && !Util.bool(r.eliminato); })
      .sort(function (a, b) { return (parseInt(a.ordine, 10) || 0) - (parseInt(b.ordine, 10) || 0); })
      .map(function (r) {
        var o = { id: r.id };
        Object.keys(d.campi).forEach(function (c) { o[c] = r[c] || ''; });
        return o;
      });
  }

  function allegati(eventoId, sezione) {
    return Db.all('allegati')
      .filter(function (r) { return r.evento_id === eventoId && r.sezione === sezione && !Util.bool(r.nel_cestino); })
      .sort(function (a, b) { return a.caricato_il < b.caricato_il ? -1 : 1; })
      .map(function (r) {
        return { id: r.id, nome: r.nome, mime: r.mime, byte: parseInt(r.byte, 10) || 0, caricato_da: r.caricato_da, caricato_il: r.caricato_il };
      });
  }

  function vista(eventoId, sezione) {
    var t = testata(eventoId, sezione);
    return {
      righe: righe(eventoId, sezione),
      testo: t ? t.testo : '',
      versione: t ? t.versione : '0',
      allegati: allegati(eventoId, sezione)
    };
  }

  /** Tutte e tre le sezioni di un evento (incluse nella risposta di eventi.get). */
  function tutte(eventoId) {
    var out = {};
    Object.keys(DEF).forEach(function (s) { out[s] = vista(eventoId, s); });
    return out;
  }

  /** Controlla la versione della sezione e la fa avanzare. Da chiamare dentro Db.withLock. */
  function avanza(eventoId, sezione, versione, user) {
    var t = testata(eventoId, sezione);
    var attuale = t ? t.versione : '0';
    if (versione !== undefined && versione !== null && String(versione) !== String(attuale)) {
      throw new CtrlError('CONFLICT', 'Questa sezione è stata modificata da un altro utente. Ricarica e riprova.', { attuale: { versione: attuale } });
    }
    if (!t) {
      t = Db.insert('testi', { id: Util.newId('tx'), evento_id: eventoId, sezione: sezione, testo: '', versione: '0' });
    }
    return Db.update('testi', 'id', t.id, { aggiornato_il: Util.nowIso(), aggiornato_da: user.email });
  }

  function pulisciRiga(d, r, i) {
    var o = {};
    Object.keys(d.campi).forEach(function (c) { o[c] = Util.text(r && r[c], d.campi[c]); });
    var vuota = Object.keys(d.campi).every(function (c) { return !o[c]; });
    if (vuota) return null;
    if (!o[d.obbligatorio]) {
      throw new CtrlError('INVALID', 'Riga ' + (i + 1) + ': il campo "' + d.obbligatorio + '" è obbligatorio');
    }
    (d.orari || []).forEach(function (c) {
      if (o[c] && !Util.isTime(o[c])) throw new CtrlError('INVALID', 'Riga ' + (i + 1) + ': orario non valido (usa HH:MM)');
    });
    o.id = r && typeof r.id === 'string' ? r.id : '';
    return o;
  }

  /** Sostituisce l'elenco delle righe di una sezione (nuove, modificate, tolte, ordine). */
  function salvaRighe(user, p) {
    Users.require(user, 'modificare');
    p = p || {};
    var d = def(p.sezione);
    if (!Array.isArray(p.righe)) throw new CtrlError('INVALID', 'Righe non valide');
    if (p.righe.length > MAX_RIGHE) throw new CtrlError('INVALID', 'Massimo ' + MAX_RIGHE + ' righe');
    var pulite = [];
    p.righe.forEach(function (r, i) { var o = pulisciRiga(d, r, i); if (o) pulite.push(o); });

    return Db.withLock(function () {
      var e = evento(p.evento_id);
      avanza(e.id, p.sezione, p.versione, user);
      var now = Util.nowIso();
      var esistenti = {};
      Db.all(d.tabella).forEach(function (r) {
        if (r.evento_id === e.id && !Util.bool(r.eliminato)) esistenti[r.id] = r;
      });
      var res = { nuove: 0, modificate: 0, tolte: 0 };
      var visti = {};
      pulite.forEach(function (o, i) {
        var ordine = String(i + 1);
        var prima = o.id && esistenti[o.id];
        if (prima && !visti[o.id]) {
          visti[o.id] = true;
          var patch = {};
          Object.keys(d.campi).forEach(function (c) { if ((prima[c] || '') !== o[c]) patch[c] = o[c]; });
          if (prima.ordine !== ordine) patch.ordine = ordine;
          if (Object.keys(patch).length) {
            patch.aggiornato_il = now; patch.aggiornato_da = user.email;
            Db.update(d.tabella, 'id', o.id, patch);
            if (Object.keys(patch).some(function (k) { return d.campi[k] !== undefined; })) res.modificate++;
          }
          return;
        }
        var nuova = { id: Util.newId(p.sezione.slice(0, 3)), evento_id: e.id, ordine: ordine, eliminato: 'FALSE',
          creato_il: now, aggiornato_il: now, aggiornato_da: user.email, versione: '1' };
        Object.keys(d.campi).forEach(function (c) { nuova[c] = o[c]; });
        Db.insert(d.tabella, nuova);
        res.nuove++;
      });
      Object.keys(esistenti).forEach(function (id) {
        if (visti[id]) return;
        Db.update(d.tabella, 'id', id, { eliminato: 'TRUE', aggiornato_il: now, aggiornato_da: user.email });
        res.tolte++;
      });
      Storico.log(user.email, e.id, p.sezione, 'righe', '', '', res);
      return vista(e.id, p.sezione);
    });
  }

  function salvaTesto(user, p) {
    Users.require(user, 'modificare');
    p = p || {};
    def(p.sezione);
    var testo = String(p.testo || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (testo.length > MAX_TESTO) throw new CtrlError('INVALID', 'Testo troppo lungo (massimo ' + MAX_TESTO + ' caratteri)');
    return Db.withLock(function () {
      var e = evento(p.evento_id);
      var t = testata(e.id, p.sezione);
      var prima = t ? t.testo : '';
      var dopo = avanza(e.id, p.sezione, p.versione, user);
      Db.update('testi', 'id', dopo.id, { testo: testo }, null, true);
      if (prima !== testo) Storico.log(user.email, e.id, p.sezione, 'testo', '', prima, testo);
      return vista(e.id, p.sezione);
    });
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
    def(p.sezione);
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
      return vista(e.id, p.sezione);
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
      return vista(a.evento_id, a.sezione);
    });
  }

  return {
    DEF: DEF, MAX_BYTE: MAX_BYTE, tutte: tutte, vista: vista,
    salvaRighe: salvaRighe, salvaTesto: salvaTesto, carica: carica, scarica: scarica, elimina: elimina
  };
})();
