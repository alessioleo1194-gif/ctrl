/**
 * CTRL · Documenti operativi di una produzione: Production Plan ("plan") e Material List ("materiali").
 *
 * Ogni documento è un JSON salvato per intero (spezzato in parti da 30.000 caratteri, limite delle celle).
 * Salvataggio ottimistico: il client manda la versione che ha letto; se nel frattempo è cambiata,
 * la risposta è { conflitto: true, versione, dati } (non un errore) e il client unisce le modifiche per riga.
 */
var Documenti = (function () {
  var TIPI = ['plan', 'materiali'];
  var PARTE = 30000;
  var MAX_CARATTERI = 600000;
  var CATALOGO_ATTIVITA = ['Load-in', 'Setup', 'Stage Setup', 'Backline Setup', 'Line Check', 'Soundcheck', 'Rehearsal', 'Doors Open',
    'Show Start', 'Show End', 'Changeover', 'Break', 'Lunch', 'Dinner', 'Catering', 'Load-out', 'Strike', 'Travel', 'Transfer'];

  function vivo(r) { return r && !Util.bool(r.eliminato); }
  function tipoValido(t) {
    if (TIPI.indexOf(t) < 0) throw new CtrlError('INVALID', 'Tipo di documento non valido');
    return t;
  }
  function produzione(id) {
    var p = Db.find('progetti', 'id', String(id || ''));
    if (!vivo(p)) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
    return p;
  }
  function trovaDoc(pid, tipo) {
    return Db.all('documenti').filter(function (d) { return d.progetto_id === pid && d.tipo === tipo && vivo(d); })[0] || null;
  }
  function leggi(doc) {
    var n = parseInt(doc.parti, 10) || 0;
    var parti = Db.all('documenti_parti').filter(function (r) { return r.documento_id === doc.id; })
      .sort(function (a, b) { return a.n - b.n; }).slice(0, n);
    try { return JSON.parse(parti.map(function (r) { return r.testo; }).join('')); } catch (e) { return null; }
  }

  // ---------- pulizia dei dati in arrivo ----------
  function t(v, max) { return Util.text(v, max); }
  function idv(v, i, pre) { var s = String(v || '').replace(/[^\w-]/g, '').slice(0, 40); return s || pre + '_' + i; }
  function lista(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

  function pulisciPlan(d) {
    d = d || {};
    return {
      lingua: d.lingua === 'it' ? 'it' : 'en',
      crew: lista(d.crew, 100).map(function (r, i) {
        r = r || {};
        return { id: idv(r.id, i, 'c'), nome: t(r.nome, 80), ruolo: t(r.ruolo, 80), telefono: t(r.telefono, 30), email: t(r.email, 120) };
      }),
      giorni: lista(d.giorni, 31).map(function (g, gi) {
        g = g || {};
        return {
          id: idv(g.id, gi, 'g'), data: Util.isDate(g.data) ? g.data : '',
          righe: lista(g.righe, 400).map(function (r, i) {
            r = r || {};
            return { id: idv(r.id, i, 'r'), sez: t(r.sez, 40), ora: t(r.ora, 20), att: t(r.att, 120), loc: t(r.loc, 80), note: t(r.note, 600) };
          })
        };
      })
    };
  }
  function pulisciMateriali(d) {
    d = d || {};
    return {
      sezioni: lista(d.sezioni, 100).map(function (s, si) {
        s = s || {};
        return {
          id: idv(s.id, si, 's'), nome: t(s.nome, 80),
          righe: lista(s.righe, 500).map(function (r, i) {
            r = r || {};
            return { id: idv(r.id, i, 'm'), voce: t(r.voce, 120), qta: t(r.qta, 12), unita: t(r.unita, 20), note: t(r.note, 300) };
          })
        };
      })
    };
  }
  function pulisci(tipo, d) { return tipo === 'plan' ? pulisciPlan(d) : pulisciMateriali(d); }

  // ---------- suggerimenti dai documenti già scritti ----------
  function suggerimenti(tipo, escludiDoc) {
    var docs = Db.all('documenti').filter(function (d) { return d.tipo === tipo && vivo(d) && d.id !== escludiDoc; })
      .sort(function (a, b) { return String(b.aggiornato_il).localeCompare(String(a.aggiornato_il)); }).slice(0, 40);
    var visti = {}, out = [];
    docs.forEach(function (doc) {
      var j = leggi(doc);
      if (!j) return;
      if (tipo === 'plan') {
        j.crew.forEach(function (c) {
          var k = c.nome.toLowerCase();
          if (!k || visti[k]) return;
          visti[k] = true;
          out.push({ nome: c.nome, ruolo: c.ruolo, telefono: c.telefono, email: c.email });
        });
      } else {
        j.sezioni.forEach(function (s) {
          s.righe.forEach(function (r) {
            var k = r.voce.toLowerCase();
            if (!k || visti[k]) return;
            visti[k] = true;
            out.push({ voce: r.voce, unita: r.unita, note: r.note });
          });
        });
      }
    });
    return out.slice(0, 500);
  }

  function intestazione(pid) {
    var eventi = Db.all('eventi').filter(function (e) { return e.progetto_id === pid; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
    return eventi.map(function (e) {
      return { id: e.id, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data, ora_inizio: e.ora_inizio, luogo: e.luogo };
    });
  }

  function vista(user, p, tipo, doc, dati) {
    return {
      produzione: { id: p.id, nome: p.nome, tipo: p.tipo || 'evento' },
      eventi: intestazione(p.id),
      tipo: tipo,
      versione: doc ? String(doc.versione) : '0',
      dati: dati,
      aggiornato_il: doc ? doc.aggiornato_il : '',
      aggiornato_da: doc ? doc.aggiornato_da : '',
      permessi: { modificare: Users.can(user, 'modificare') },
      catalogo_attivita: tipo === 'plan' ? CATALOGO_ATTIVITA.slice() : undefined,
      suggerimenti: suggerimenti(tipo, doc && doc.id)
    };
  }

  function get(user, p) {
    var tipo = tipoValido(p && p.tipo), pr = produzione(p && p.produzione_id);
    Staff.richiediProduzione(user, pr.id);
    var doc = trovaDoc(pr.id, tipo);
    return vista(user, pr, tipo, doc, doc ? leggi(doc) : null);
  }

  function scrivi(doc, testo) {
    var pezzi = [];
    for (var i = 0; i < testo.length; i += PARTE) pezzi.push(testo.slice(i, i + PARTE));
    var esist = Db.all('documenti_parti').filter(function (r) { return r.documento_id === doc.id; });
    var vecchie = {};
    esist.forEach(function (r) { vecchie[r.n] = r; });
    pezzi.forEach(function (txt, n) {
      if (vecchie[n]) Db.update('documenti_parti', 'id', vecchie[n].id, { testo: txt }, null, true);
      else Db.insert('documenti_parti', { id: doc.id + '_' + n, documento_id: doc.id, n: String(n), testo: txt });
    });
    return pezzi.length;
  }

  function salva(user, p) {
    Users.require(user, 'modificare');
    var tipo = tipoValido(p && p.tipo);
    var pr = produzione(p && p.produzione_id);
    Staff.richiediProduzione(user, pr.id);
    var dati = pulisci(tipo, p && p.dati);
    var testo = JSON.stringify(dati);
    if (testo.length > MAX_CARATTERI) throw new CtrlError('INVALID', 'Documento troppo grande');
    return Db.withLock(function () {
      var doc = trovaDoc(pr.id, tipo);
      var attuale = doc ? String(doc.versione) : '0';
      if (String(p.versione || '0') !== attuale) {
        var out = vista(user, pr, tipo, doc, doc ? leggi(doc) : null);
        out.conflitto = true;
        return out;
      }
      var now = Util.nowIso(), nuova = String((parseInt(attuale, 10) || 0) + 1);
      if (!doc) {
        doc = Db.insert('documenti', { id: Util.newId('doc'), progetto_id: pr.id, tipo: tipo, versione: '0', parti: '0',
          creato_il: now, creato_da: user.email, aggiornato_il: now, aggiornato_da: user.email, eliminato: 'FALSE' });
      }
      var n = scrivi(doc, testo);
      Db.update('documenti', 'id', doc.id, { versione: nuova, parti: String(n), aggiornato_il: now, aggiornato_da: user.email }, null, true);
      var ev = intestazione(pr.id)[0];
      Storico.log(user.email, ev ? ev.id : '', 'documento', 'salva', doc.id, '', { tipo: tipo, versione: nuova, caratteri: testo.length });
      return { conflitto: false, versione: nuova, aggiornato_il: now, aggiornato_da: user.email, dati: dati };
    });
  }

  var PDF = { plan: { sezione: 'piano', prefisso: 'Production Plan - ' }, materiali: { sezione: 'materiale', prefisso: 'Material List - ' } };

  /**
   * Archivia il PDF generato dal browser come file dell'evento (sezione piano o materiale).
   * Per i festival il PDF va in tutti gli eventi collegati, come il documento.
   */
  function salvaPdf(user, p) {
    Users.require(user, 'modificare');
    p = p || {};
    var tipo = tipoValido(p.tipo);
    var pr = produzione(p.produzione_id);
    Staff.richiediProduzione(user, pr.id);
    var conf = PDF[tipo];
    var nome = Util.text(p.nome, 150).replace(/[\\/]+/g, '-');
    if (nome.indexOf(conf.prefisso) !== 0 || !/\.pdf$/i.test(nome)) throw new CtrlError('INVALID', 'Nome del PDF non valido');
    if (typeof p.dati !== 'string' || !p.dati) throw new CtrlError('INVALID', 'PDF vuoto');
    if (p.dati.length > Math.ceil(Allegati.MAX_BYTE / 3) * 4 + 4) throw new CtrlError('TOO_LARGE', 'PDF troppo grande');
    var bytes;
    try { bytes = Utilities.base64Decode(p.dati); } catch (err) { throw new CtrlError('INVALID', 'PDF non leggibile'); }
    if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) throw new CtrlError('INVALID', 'Il file non è un PDF');
    return Db.withLock(function () {
      var eventi = Db.all('eventi').filter(function (e) { return e.progetto_id === pr.id; });
      if (!eventi.length) throw new CtrlError('NOT_FOUND', 'Nessun evento collegato alla scheda');
      eventi.forEach(function (e) { Allegati.sostituisciPdf(user, e, conf.sezione, conf.prefisso, nome, bytes); });
      return { eventi: eventi.map(function (e) { return e.id; }), sezione: conf.sezione, nome: nome };
    });
  }

  /** "9:00", "9.30", "09:00" → "09:00"; qualunque altra cosa ("TBD", "dopo il soundcheck") → "". */
  function oraPlan_(v) {
    var m = /^\s*(\d{1,2})\s*[:.h]\s*(\d{2})\s*$/.exec(String(v || ''));
    if (!m) return '';
    var o = ('0' + m[1]).slice(-2) + ':' + m[2];
    return Util.isTime(o) ? o : '';
  }

  /**
   * Orari di Load-in e Load-out scritti nel Production Plan, giornata per giornata: { 'yyyy-mm-dd': { load_in, load_out } }.
   * Più righe nella stessa giornata: il Load-in è il più presto, il Load-out il più tardo. Orari non leggibili si ignorano.
   * Serve all'anteprima dell'evento in elenco; non scrive nulla.
   */
  function orariPlan(pid) {
    var out = {};
    var doc = pid ? trovaDoc(String(pid), 'plan') : null;
    var dati = doc ? leggi(doc) : null;
    if (!dati || !Array.isArray(dati.giorni)) return out;
    dati.giorni.forEach(function (g) {
      if (!g || !Util.isDate(g.data)) return;
      var inn = '', fuori = '';
      (g.righe || []).forEach(function (r) {
        var att = String((r && r.att) || '').toLowerCase().replace(/[\s_-]+/g, '');
        var o = oraPlan_(r && r.ora);
        if (!o) return;
        if (att.indexOf('loadin') === 0 && (!inn || o < inn)) inn = o;
        if (att.indexOf('loadout') === 0 && (!fuori || o > fuori)) fuori = o;
      });
      if (inn || fuori) out[g.data] = { load_in: inn, load_out: fuori };
    });
    return out;
  }

  return { TIPI: TIPI, CATALOGO_ATTIVITA: CATALOGO_ATTIVITA, orariPlan: orariPlan, get: get, salva: salva, salvaPdf: salvaPdf, pulisci: pulisci, riepilogo: function (pid) {
    var r = {};
    TIPI.forEach(function (tp) { var d = trovaDoc(pid, tp); r[tp] = d ? { versione: d.versione, aggiornato_il: d.aggiornato_il } : null; });
    return r;
  } };
})();
