/**
 * CTRL · Giornate degli eventi.
 *
 * Ogni evento ha una o più giornate (tabella `giorni`), una per data. Le giornate nascono dal Calendar
 * (o dalle date di un evento manuale) e si possono correggere in CTRL: orari e nota per giornata.
 *
 * - Orario in vigore = ora_inizio / ora_fine. Origine dell'orario: "calendario" (segue il Calendar) o "manuale".
 * - Se un orario corretto a mano non coincide più con quello del Calendar, si segnala la differenza (diff):
 *   l'Owner o Production sceglie se tenere il proprio orario o usare quello nuovo del Calendar. Mai sovrascritto in silenzio.
 * - Fine prima dell'inizio = la giornata finisce dopo la mezzanotte (il giorno dopo).
 * - Evento di un solo giorno con orario a cavallo della mezzanotte = una sola giornata.
 * - Evento su più giorni: il primo giorno prende l'inizio, l'ultimo la fine, gli altri orari restano "da definire".
 * - Le giornate non si cancellano: `eliminato`. Una giornata tolta a mano non ritorna con la sincronizzazione.
 */
var Giorni = (function () {
  var MAX_GIORNI = 60;

  /** Giornate previste dalle date/orari dell'evento (Calendar o manuale). */
  function calGiorni(e) {
    var d0 = e.data, d1 = e.data_fine || e.data;
    if (!Util.isDate(d0)) return [];
    if (!Util.isDate(d1) || d1 < d0) d1 = d0;
    var n = Util.diffDays(d0, d1) + 1;
    var a = e.ora_inizio || '', b = e.ora_fine || '';
    // un solo evento a cavallo della mezzanotte (22:00 → 02:00 del giorno dopo) è una giornata
    if (n === 2 && a && b && Util.minuti(b) <= Util.minuti(a)) n = 1;
    if (n > MAX_GIORNI) n = MAX_GIORNI;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        data: Util.addDays(d0, i),
        ora_inizio: n === 1 ? a : (i === 0 ? a : ''),
        ora_fine: n === 1 ? b : (i === n - 1 ? b : '')
      });
    }
    return out;
  }

  /** Intervallo in minuti assoluti (dal 1970) o null se manca un orario. Fine <= inizio = il giorno dopo. */
  function intervallo(data, inizio, fine) {
    var s = Util.minuti(inizio), e = Util.minuti(fine);
    if (s === null || e === null || !Util.isDate(data)) return null;
    var base = Util.dayNum(data) * 1440;
    return { s: base + s, e: base + e + (e <= s ? 1440 : 0) };
  }

  function dopoMezzanotte(inizio, fine) {
    var s = Util.minuti(inizio), e = Util.minuti(fine);
    return s !== null && e !== null && e <= s;
  }

  function attivo(r) { return !Util.bool(r.eliminato); }

  function righeEvento(eventoId) {
    return Db.all('giorni').filter(function (r) { return r.evento_id === eventoId; });
  }

  /** Giornate attive di un evento, in ordine di data. */
  function attive(eventoId) {
    return righeEvento(eventoId).filter(attivo).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
  }

  function haTurni(giornoId) {
    return Db.all('turni').some(function (t) { return t.giorno_id === giornoId && !Util.bool(t.eliminato); });
  }

  /**
   * Allinea le giornate di un evento alle sue date. Da chiamare dentro Db.withLock, dopo ogni
   * creazione/aggiornamento dell'evento. Ritorna true se qualcosa è cambiato.
   */
  function riallinea(e, actorEmail) {
    var stamp = Util.nowIso();
    var autore = actorEmail || 'calendar';
    var righe = righeEvento(e.id);
    var perData = {};
    righe.forEach(function (r) { perData[r.data] = r; });
    var calc = calGiorni(e);
    var vive = {};
    var cambiato = false;

    calc.forEach(function (c) {
      vive[c.data] = true;
      var r = perData[c.data];
      if (!r) {
        Db.insert('giorni', {
          id: Util.newId('gi'), evento_id: e.id, data: c.data, ora_inizio: c.ora_inizio, ora_fine: c.ora_fine,
          origine: 'calendario', origine_orario: 'calendario', cal_inizio: c.ora_inizio, cal_fine: c.ora_fine, cal_base: '',
          nota: '', stato: 'attiva', eliminato: '', creato_il: stamp, aggiornato_il: stamp, aggiornato_da: autore, versione: '1'
        });
        cambiato = true;
        return;
      }
      if (!attivo(r) || r.origine !== 'calendario') return;   // tolta a mano o aggiunta a mano: non si tocca
      var patch = {};
      if (r.cal_inizio !== c.ora_inizio) patch.cal_inizio = c.ora_inizio;
      if (r.cal_fine !== c.ora_fine) patch.cal_fine = c.ora_fine;
      if (r.origine_orario !== 'manuale') {
        if (r.ora_inizio !== c.ora_inizio) patch.ora_inizio = c.ora_inizio;
        if (r.ora_fine !== c.ora_fine) patch.ora_fine = c.ora_fine;
      }
      if (r.stato === 'fuori_calendario') patch.stato = 'attiva';
      if (Object.keys(patch).length) {
        patch.aggiornato_il = stamp; patch.aggiornato_da = autore;
        Db.update('giorni', 'id', r.id, patch);
        cambiato = true;
      }
    });

    // giornate nate dal Calendar che il Calendar non indica più
    righe.forEach(function (r) {
      if (!attivo(r) || r.origine !== 'calendario' || vive[r.data]) return;
      var toccata = r.origine_orario === 'manuale' || !!r.nota || haTurni(r.id);
      if (!toccata) {
        Db.update('giorni', 'id', r.id, { eliminato: 'TRUE', aggiornato_il: stamp, aggiornato_da: autore });
        cambiato = true;
      } else if (r.stato !== 'fuori_calendario') {
        Db.update('giorni', 'id', r.id, { stato: 'fuori_calendario', aggiornato_il: stamp, aggiornato_da: autore });
        cambiato = true;
      }
    });

    // un evento ha sempre almeno una giornata
    if (calc.length && !attive(e.id).length) {
      var c0 = calc[0], r0 = perData[c0.data];
      if (r0) Db.update('giorni', 'id', r0.id, { eliminato: '', stato: 'attiva', aggiornato_il: stamp, aggiornato_da: autore });
      else Db.insert('giorni', {
        id: Util.newId('gi'), evento_id: e.id, data: c0.data, ora_inizio: c0.ora_inizio, ora_fine: c0.ora_fine,
        origine: 'calendario', origine_orario: 'calendario', cal_inizio: c0.ora_inizio, cal_fine: c0.ora_fine, cal_base: '',
        nota: '', stato: 'attiva', eliminato: '', creato_il: stamp, aggiornato_il: stamp, aggiornato_da: autore, versione: '1'
      });
      cambiato = true;
    }
    return cambiato;
  }

  // ---------- vista ----------
  function chiaveCal(r) { return (r.cal_inizio || '') + '|' + (r.cal_fine || ''); }

  /** La giornata ha un orario corretto a mano e il Calendar nel frattempo è cambiato. */
  function differenza(r) {
    return r.origine === 'calendario' && r.origine_orario === 'manuale' && r.stato !== 'fuori_calendario' && chiaveCal(r) !== (r.cal_base || '');
  }

  function vistaBase(r, n, di, accesso) {
    return {
      id: r.id, n: n, di: di, data: r.data, ora_inizio: r.ora_inizio, ora_fine: r.ora_fine,
      dopo_mezzanotte: dopoMezzanotte(r.ora_inizio, r.ora_fine),
      origine: r.origine, origine_orario: r.origine_orario, cal_inizio: r.cal_inizio, cal_fine: r.cal_fine,
      diff: differenza(r), stato: r.stato, nota: accesso ? r.nota : '', versione: r.versione, virtuale: false
    };
  }

  /**
   * Strumento per le liste: una sola lettura delle tabelle. `st` è il risultato di Staff.perLista(user).
   * di(e) → giornate dell'evento già pronte, con lo staff di ogni giornata.
   */
  function perLista(user, st) {
    var owner = !!(user && Users.can(user, 'admin'));
    var perEv = {};
    Db.all('giorni').forEach(function (r) {
      if (!attivo(r)) return;
      (perEv[r.evento_id] = perEv[r.evento_id] || []).push(r);
    });
    var turniPer = Turni.perGiorno();
    var analisi = owner ? Turni.analizza() : null;
    var planPer = {};
    /** Load-in e Load-out del Production Plan, solo a chi può vedere i documenti dell'evento. */
    function orariPlan(e, accesso) {
      if (!accesso || !e.progetto_id) return {};
      if (!planPer[e.progetto_id]) planPer[e.progetto_id] = Documenti.orariPlan(e.progetto_id);
      return planPer[e.progetto_id];
    }
    return {
      analisi: analisi,
      conflitti: function (eventoId) { return analisi ? analisi.sovrapposizioniEvento(eventoId) : 0; },
      di: function (e) {
        var righe = (perEv[e.id] || []).slice().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
        var accesso = st.accesso(e);
        var plan = orariPlan(e, accesso);
        if (!righe.length) {
          // evento senza giornate scritte (non ancora allineato): si mostrano quelle previste, in sola lettura
          var calc = calGiorni(e);
          return calc.map(function (c, i) {
            return { id: '', n: i + 1, di: calc.length, data: c.data, ora_inizio: c.ora_inizio, ora_fine: c.ora_fine,
              dopo_mezzanotte: dopoMezzanotte(c.ora_inizio, c.ora_fine), origine: 'calendario', origine_orario: 'calendario',
              cal_inizio: c.ora_inizio, cal_fine: c.ora_fine, diff: false, stato: 'attiva', nota: '', versione: '0', virtuale: true, staff: [], plan: plan[c.data] || null };
          });
        }
        return righe.map(function (r, i) {
          var v = vistaBase(r, i + 1, righe.length, accesso);
          v.staff = Turni.staffGiorno(r.id, turniPer, owner, analisi);
          v.plan = plan[r.data] || null;
          return v;
        });
      }
    };
  }

  // ---------- azioni ----------
  function giornoDi_(id) {
    var r = Db.find('giorni', 'id', String(id || ''));
    if (!r || !attivo(r)) throw new CtrlError('NOT_FOUND', 'Giornata non trovata');
    return r;
  }

  function eventoDi_(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  /** Orari e giornate: serve poter modificare. La nota è un contenuto riservato allo staff dell'evento. */
  function permessi_(user, e, conNota) {
    Users.require(user, 'modificare');
    if (conNota) Staff.richiediEvento(user, e);
    else if (!Staff.puoVedere(user, e)) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
  }

  function orario_(v, etichetta) {
    var t = v === undefined || v === null ? '' : String(v).trim();
    if (t && !Util.isTime(t)) throw new CtrlError('INVALID', etichetta + ' non valido');
    return t;
  }

  function rispondi_(user, eventoId) { return Events.get(user, { id: eventoId }); }

  /** Orari e nota di una giornata. Un orario diverso dal Calendar diventa "manuale". */
  function salva(user, p) {
    p = p || {};
    var r0 = giornoDi_(p.id);
    var e = eventoDi_(r0.evento_id);
    permessi_(user, e, 'nota' in p);
    var patch = {};
    var tocca = 'ora_inizio' in p || 'ora_fine' in p;
    var inizio = r0.ora_inizio, fine = r0.ora_fine;
    if ('ora_inizio' in p) inizio = orario_(p.ora_inizio, 'Orario di inizio');
    if ('ora_fine' in p) fine = orario_(p.ora_fine, 'Orario di fine');
    if (tocca && inizio && fine && inizio === fine) throw new CtrlError('INVALID', 'Inizio e fine coincidono');
    if ('nota' in p) patch.nota = Util.text(p.nota, 500);
    if (tocca && (inizio !== r0.ora_inizio || fine !== r0.ora_fine)) {
      patch.ora_inizio = inizio; patch.ora_fine = fine;
      if (r0.origine === 'calendario') {
        if (inizio === (r0.cal_inizio || '') && fine === (r0.cal_fine || '')) { patch.origine_orario = 'calendario'; patch.cal_base = ''; }
        else {
          patch.origine_orario = 'manuale';
          // si ricorda cosa diceva il Calendar quando l'orario è stato corretto
          if (r0.origine_orario !== 'manuale') patch.cal_base = chiaveCal(r0);
        }
      } else patch.origine_orario = 'manuale';
    }
    if (!Object.keys(patch).length) throw new CtrlError('INVALID', 'Nessuna modifica');
    patch.aggiornato_il = Util.nowIso(); patch.aggiornato_da = user.email;
    return Db.withLock(function () {
      var prima = JSON.parse(JSON.stringify(Db.find('giorni', 'id', r0.id)));
      var row = Db.update('giorni', 'id', r0.id, patch, p.versione);
      var d = Storico.diff(prima, row, ['ora_inizio', 'ora_fine', 'nota', 'origine_orario']);
      if (d.changed) { d.prima.giorno = row.data; Storico.log(user.email, e.id, 'giornata', 'modifica', row.id, d.prima, d.dopo); }
      return rispondi_(user, e.id);
    });
  }

  /** Davanti a una differenza col Calendar: usa il nuovo orario del Calendar oppure tieni il proprio. */
  function calendario(user, p) {
    p = p || {};
    var r0 = giornoDi_(p.id);
    var e = eventoDi_(r0.evento_id);
    permessi_(user, e);
    var scelta = String(p.scelta || '');
    if (scelta !== 'usa' && scelta !== 'tieni') throw new CtrlError('INVALID', 'Scelta non valida');
    if (r0.origine !== 'calendario') throw new CtrlError('INVALID', 'Questa giornata non arriva dal Calendar');
    return Db.withLock(function () {
      var prima = JSON.parse(JSON.stringify(Db.find('giorni', 'id', r0.id)));
      var patch = { aggiornato_il: Util.nowIso(), aggiornato_da: user.email };
      if (scelta === 'usa') {
        patch.ora_inizio = r0.cal_inizio; patch.ora_fine = r0.cal_fine; patch.origine_orario = 'calendario'; patch.cal_base = '';
      } else {
        patch.cal_base = chiaveCal(r0);
      }
      var row = Db.update('giorni', 'id', r0.id, patch, p.versione);
      Storico.log(user.email, e.id, 'giornata', scelta === 'usa' ? 'orario_calendario' : 'orario_tenuto', row.id,
        { giorno: row.data, ora_inizio: prima.ora_inizio, ora_fine: prima.ora_fine }, { ora_inizio: row.ora_inizio, ora_fine: row.ora_fine });
      return rispondi_(user, e.id);
    });
  }

  /** Aggiunge una giornata a mano (montaggio il giorno prima, smontaggio il giorno dopo…). */
  function aggiungi(user, p) {
    p = p || {};
    var e = eventoDi_(p.evento_id);
    permessi_(user, e);
    if (!Util.isDate(p.data)) throw new CtrlError('INVALID', 'Data non valida');
    var inizio = orario_(p.ora_inizio, 'Orario di inizio'), fine = orario_(p.ora_fine, 'Orario di fine');
    if (inizio && fine && inizio === fine) throw new CtrlError('INVALID', 'Inizio e fine coincidono');
    return Db.withLock(function () {
      var righe = righeEvento(e.id);
      if (righe.filter(attivo).length >= MAX_GIORNI) throw new CtrlError('INVALID', 'Troppe giornate per questo evento');
      var stamp = Util.nowIso();
      var esistente = righe.filter(function (r) { return r.data === p.data; })[0];
      var row;
      if (esistente && attivo(esistente)) throw new CtrlError('CONFLICT', 'Esiste già una giornata con questa data');
      if (esistente) {
        // giornata tolta in precedenza: si riattiva come giornata manuale
        row = Db.update('giorni', 'id', esistente.id, { eliminato: '', stato: 'attiva', origine: 'manuale', origine_orario: 'manuale',
          ora_inizio: inizio, ora_fine: fine, cal_inizio: '', cal_fine: '', cal_base: '', nota: '', aggiornato_il: stamp, aggiornato_da: user.email });
      } else {
        row = Db.insert('giorni', {
          id: Util.newId('gi'), evento_id: e.id, data: p.data, ora_inizio: inizio, ora_fine: fine, origine: 'manuale', origine_orario: 'manuale',
          cal_inizio: '', cal_fine: '', cal_base: '', nota: '', stato: 'attiva', eliminato: '', creato_il: stamp, aggiornato_il: stamp,
          aggiornato_da: user.email, versione: '1'
        });
      }
      Storico.log(user.email, e.id, 'giornata', 'aggiungi', row.id, '', { giorno: row.data, ora_inizio: inizio, ora_fine: fine });
      Turni.riallinea(e, user.email);
      return rispondi_(user, e.id);
    });
  }

  /** Toglie una giornata. Se c'è staff assegnato serve la conferma (conferma: true). Almeno una giornata resta. */
  function rimuovi(user, p) {
    p = p || {};
    var r0 = giornoDi_(p.id);
    var e = eventoDi_(r0.evento_id);
    permessi_(user, e);
    return Db.withLock(function () {
      var vive = attive(e.id);
      if (vive.length <= 1) throw new CtrlError('INVALID', 'L\'evento deve avere almeno una giornata');
      var turni = Db.all('turni').filter(function (t) { return t.giorno_id === r0.id && !Util.bool(t.eliminato); });
      if (turni.length && !p.conferma) return { richiede_conferma: true, turni: turni.length, giorno: r0.data };
      var stamp = Util.nowIso();
      turni.forEach(function (t) { Db.update('turni', 'id', t.id, { eliminato: 'TRUE', aggiornato_il: stamp, aggiornato_da: user.email }); });
      Db.update('giorni', 'id', r0.id, { eliminato: 'TRUE', aggiornato_il: stamp, aggiornato_da: user.email });
      Storico.log(user.email, e.id, 'giornata', 'rimuovi', r0.id, { giorno: r0.data, turni_tolti: turni.length }, '');
      return rispondi_(user, e.id);
    });
  }

  return {
    calGiorni: calGiorni, intervallo: intervallo, dopoMezzanotte: dopoMezzanotte, riallinea: riallinea, attive: attive,
    perLista: perLista, salva: salva, calendario: calendario, aggiungi: aggiungi, rimuovi: rimuovi, differenza: differenza,
    righeEvento: righeEvento, MAX_GIORNI: MAX_GIORNI
  };
})();
