/**
 * CTRL · Eventi.
 *
 * - origine "calendar": titolo, date, orari, luogo, descrizione e colore arrivano dal Google Calendar (che CTRL legge soltanto).
 *   Titolo, luogo, descrizione e date si possono correggere in CTRL (solo Owner): la correzione resta anche dopo la sincronizzazione;
 *   se poi il Calendar cambia quel dato si segnala la differenza e l'Owner sceglie. Gli orari si correggono nelle giornate.
 * - origine "manuale": creati dall'admin, tutti i campi modificabili in CTRL.
 */
var Events = (function () {
  var CAL_FIELDS = ['titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo', 'descrizione', 'colore'];
  var COLORE_DEFAULT = '#5b6472';
  // dati del Calendar che l'Owner può correggere in CTRL (gli orari si correggono per giornata, il colore non cambia)
  var CORREGGIBILI = ['titolo', 'data', 'data_fine', 'luogo', 'descrizione'];

  function json_(txt) {
    try { var o = txt ? JSON.parse(txt) : {}; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (err) { return {}; }
  }
  function vuoto_(o) { return !Object.keys(o).length; }
  function testo_(o) { return vuoto_(o) ? '' : JSON.stringify(o); }

  /**
   * Sincronizzazione di un evento già noto: ritorna le modifiche da scrivere. I campi corretti a mano non si toccano:
   * se il Calendar dice ancora quello che diceva quando li hai corretti non succede nulla, altrimenti si segna la differenza.
   */
  function patchSync(row, f) {
    var patch = {};
    var mod = json_(row.modificati), diff = json_(row.cal_diff);
    var mod0 = testo_(mod), diff0 = testo_(diff);
    CAL_FIELDS.forEach(function (k) {
      var nuovo = f[k] || '';
      if (Object.prototype.hasOwnProperty.call(mod, k)) {
        if (nuovo === (row[k] || '')) { delete mod[k]; delete diff[k]; return; }   // il Calendar ora dice quello che hai scritto tu
        if (nuovo === mod[k]) delete diff[k]; else diff[k] = nuovo;
        return;
      }
      if ((row[k] || '') !== nuovo) patch[k] = f[k];
    });
    if (testo_(mod) !== mod0) patch.modificati = testo_(mod);
    if (testo_(diff) !== diff0) patch.cal_diff = testo_(diff);
    return patch;
  }

  /** Per ogni evento: presenza di contenuti in piano, materiale, scheda (oggi: file allegati). */
  function contaSezioni() {
    var out = {};
    Db.all('allegati').forEach(function (r) {
      if (Util.bool(r.nel_cestino) || Allegati.SEZIONI.indexOf(r.sezione) < 0) return;
      if (!out[r.evento_id]) out[r.evento_id] = { piano: 0, materiale: 0, scheda: 0 };
      out[r.evento_id][r.sezione]++;
    });
    return out;
  }

  function view(e, conteggi, user, st, gi) {
    var c = conteggi[e.id] || { piano: 0, materiale: 0, scheda: 0 };
    var accesso = st.accesso(e);
    var v = {
      id: e.id, origine: e.origine, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data,
      ora_inizio: e.ora_inizio, ora_fine: e.ora_fine, luogo: e.luogo, descrizione: e.descrizione,
      colore: e.colore || COLORE_DEFAULT, stato: e.stato, note: accesso ? e.note : '', versione: e.versione,
      aggiornato_il: e.aggiornato_il, aggiornato_da: e.aggiornato_da,
      produzione_id: user && Users.can(user, 'modificare') ? (e.progetto_id || '') : '',   // Plan e Material List solo a chi li può modificare
      stato_doc: { piano: c.piano > 0, materiale: c.materiale > 0, scheda: c.scheda > 0 },
      staff: st.staff(e.id), mio: st.mio(e.id), accesso: accesso, da_confermare: st.daConfermare(e.id)
    };
    v.giorni = gi.di(e);
    if (user && Users.can(user, 'admin') && e.origine === 'calendar') {
      var mod = json_(e.modificati), diff = json_(e.cal_diff), corr = {};
      Object.keys(mod).forEach(function (k) { corr[k] = { calendario: mod[k], nuovo: Object.prototype.hasOwnProperty.call(diff, k) ? diff[k] : null }; });
      v.correzioni = corr;
    }
    if (user && Users.can(user, 'admin')) v.conflitti = gi.conflitti(e.id);
    if (user && Users.can(user, 'admin') && e.cartella_id) v.cartella_url = 'https://drive.google.com/drive/folders/' + e.cartella_id;
    return v;
  }

  function list(user, p) {
    var conteggi = contaSezioni();
    var st = Staff.perLista(user);
    var gi = Giorni.perLista(user, st);
    var includiArchiviati = !!(p && p.archiviati);
    return Db.all('eventi')
      .filter(function (e) { return includiArchiviati || e.stato !== 'archiviato'; })
      .filter(function (e) { return st.vede(e); })
      .map(function (e) { return view(e, conteggi, user, st, gi); })
      .sort(function (a, b) {
        var ka = a.data + (a.ora_inizio || '99:99') + a.titolo;
        var kb = b.data + (b.ora_inizio || '99:99') + b.titolo;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
  }

  function get(user, p) {
    var e = Db.find('eventi', 'id', p && p.id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var st = Staff.perLista(user);
    // chi non può vedere l'evento riceve la stessa risposta di un evento che non esiste
    if (!st.vede(e)) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var out = view(e, contaSezioni(), user, st, Giorni.perLista(user, st));
    // chi non è nello staff vede l'evento ma non file, documenti e note
    out.allegati = out.accesso ? Allegati.perEvento(e.id) : null;
    out.produzione = out.accesso && e.progetto_id && Users.can(user, 'modificare') ? Produzioni.riepilogo(e.progetto_id) : null;
    if (Users.can(user, 'admin')) out.storico = Storico.forEvent(e.id, 30);
    return out;
  }

  function validateFields(p, partial) {
    var f = {};
    if (!partial || 'titolo' in p) {
      f.titolo = Util.text(p.titolo, 200);
      if (!f.titolo) throw new CtrlError('INVALID', 'Il titolo è obbligatorio');
    }
    if (!partial || 'data' in p) {
      if (!Util.isDate(p.data)) throw new CtrlError('INVALID', 'Data non valida');
      f.data = p.data;
    }
    if (!partial || 'data_fine' in p) {
      var df = p.data_fine || p.data || '';
      if (df && !Util.isDate(df)) throw new CtrlError('INVALID', 'Data di fine non valida');
      f.data_fine = df;
    }
    ['ora_inizio', 'ora_fine'].forEach(function (k) {
      if (!partial || k in p) {
        var t = p[k] || '';
        if (t && !Util.isTime(t)) throw new CtrlError('INVALID', 'Orario non valido');
        f[k] = t;
      }
    });
    if (!partial || 'luogo' in p) f.luogo = Util.text(p.luogo, 200);
    if (!partial || 'descrizione' in p) f.descrizione = Util.text(p.descrizione, 5000);
    if (!partial || 'colore' in p) {
      var col = p.colore || COLORE_DEFAULT;
      if (!Util.isColor(col)) throw new CtrlError('INVALID', 'Colore non valido');
      f.colore = col.toLowerCase();
    }
    return f;
  }

  function create(user, p) {
    Users.require(user, 'creareEventi');
    var f = validateFields(p || {}, false);
    if (f.data_fine && f.data_fine < f.data) throw new CtrlError('INVALID', 'La data di fine precede quella di inizio');
    return Db.withLock(function () {
      var now = Util.nowIso();
      f.id = Util.newId('ev');
      f.origine = 'manuale';
      f.stato = 'attivo';
      f.note = '';
      f.creato_il = now; f.creato_da = user.email;
      f.aggiornato_il = now; f.aggiornato_da = user.email;
      f.versione = '1';
      var row = Db.insert('eventi', f);
      Storico.log(user.email, row.id, 'evento', 'crea', row.id, '', { titolo: row.titolo, data: row.data });
      Giorni.riallinea(row, user.email);
      Staff.ricalcolaSicuro_();
      return get(user, { id: row.id });
    });
  }

  function update(user, p) {
    if (!p || !p.id) throw new CtrlError('INVALID', 'Evento mancante');
    var e = Db.find('eventi', 'id', p.id);
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    var patch = {};
    var fieldsChanged = Object.keys(p).filter(function (k) { return CAL_FIELDS.indexOf(k) >= 0; });
    if (fieldsChanged.length) {
      Users.require(user, 'creareEventi');
      var f = validateFields(p, true);
      if (e.origine === 'calendar') {
        if (fieldsChanged.some(function (k) { return CORREGGIBILI.indexOf(k) < 0; })) {
          throw new CtrlError('INVALID', 'Gli orari si correggono nella giornata; il colore arriva dal Google Calendar');
        }
        var mod = json_(e.modificati), diff = json_(e.cal_diff);
        Object.keys(f).forEach(function (k) {
          if ((e[k] || '') === (f[k] || '')) return;   // invariato
          // il valore del Calendar da ricordare: quello nuovo se c'era una differenza da risolvere, altrimenti quello che diceva
          var base = Object.prototype.hasOwnProperty.call(diff, k) ? diff[k]
            : Object.prototype.hasOwnProperty.call(mod, k) ? mod[k] : (e[k] || '');
          delete diff[k];
          if ((f[k] || '') === base) delete mod[k]; else mod[k] = base;
          patch[k] = f[k];
        });
        if (!Object.keys(patch).length) throw new CtrlError('INVALID', 'Nessuna modifica');
        patch.modificati = testo_(mod);
        patch.cal_diff = testo_(diff);
        fieldsChanged = Object.keys(patch).filter(function (k) { return CAL_FIELDS.indexOf(k) >= 0; });
      } else {
        Object.keys(f).forEach(function (k) { patch[k] = f[k]; });
      }
    }
    if ('note' in p) {
      Users.require(user, 'modificare');
      Staff.richiediEvento(user, e);
      patch.note = Util.text(p.note, 5000);
    }
    if (!Object.keys(patch).length) throw new CtrlError('INVALID', 'Nessuna modifica');
    var nextData = patch.data || e.data;
    var nextFine = 'data_fine' in patch ? patch.data_fine : e.data_fine;
    if (nextFine && nextFine < nextData) throw new CtrlError('INVALID', 'La data di fine precede quella di inizio');
    patch.aggiornato_il = Util.nowIso();
    patch.aggiornato_da = user.email;
    return Db.withLock(function () {
      var before = JSON.parse(JSON.stringify(Db.find('eventi', 'id', p.id)));
      var row = Db.update('eventi', 'id', p.id, patch, p.versione);
      var d = Storico.diff(before, row, CAL_FIELDS.concat(['note']));
      if (d.changed) Storico.log(user.email, row.id, 'evento', 'modifica', row.id, d.prima, d.dopo);
      // date o orari cambiati: le giornate (e i turni di chi lavora su tutte) seguono
      if (fieldsChanged.length) { Giorni.riallinea(row, user.email); Turni.riallinea(row, user.email); }
      if (patch.descrizione !== undefined) Staff.ricalcolaSicuro_();
      return get(user, { id: row.id });
    });
  }

  /**
   * Corregge o ripristina i dati del Calendar di un evento. scelta:
   *   "tieni"  → resta il tuo valore e la differenza segnalata si archivia;
   *   "usa"    → torna il valore del Calendar (quello nuovo se c'è una differenza, altrimenti quello di prima).
   * campo: uno solo, oppure tutti i campi corretti se manca.
   */
  function calendario(user, p) {
    Users.require(user, 'creareEventi');
    p = p || {};
    var scelta = String(p.scelta || '');
    if (scelta !== 'tieni' && scelta !== 'usa') throw new CtrlError('INVALID', 'Scelta non valida');
    return Db.withLock(function () {
      var e = Db.find('eventi', 'id', p.id);
      if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
      if (e.origine !== 'calendar') throw new CtrlError('INVALID', 'Evento non proveniente dal Calendar');
      var mod = json_(e.modificati), diff = json_(e.cal_diff);
      var campi = p.campo ? [String(p.campo)] : Object.keys(mod);
      campi.forEach(function (k) { if (CORREGGIBILI.indexOf(k) < 0 || !Object.prototype.hasOwnProperty.call(mod, k)) throw new CtrlError('INVALID', 'Campo non corretto a mano'); });
      var patch = {};
      campi.forEach(function (k) {
        if (scelta === 'usa') {
          patch[k] = Object.prototype.hasOwnProperty.call(diff, k) ? diff[k] : mod[k];
          delete mod[k]; delete diff[k];
        } else if (Object.prototype.hasOwnProperty.call(diff, k)) {
          mod[k] = diff[k]; delete diff[k];   // ora la tua correzione è rispetto al Calendar di adesso
          if (mod[k] === (e[k] || '')) delete mod[k];
        }
      });
      patch.modificati = testo_(mod); patch.cal_diff = testo_(diff);
      patch.aggiornato_il = Util.nowIso(); patch.aggiornato_da = user.email;
      var before = JSON.parse(JSON.stringify(e));
      var row = Db.update('eventi', 'id', e.id, patch);
      var d = Storico.diff(before, row, CAL_FIELDS);
      Storico.log(user.email, row.id, 'evento', scelta === 'usa' ? 'ripristino_calendario' : 'tieni_correzione', row.id, d.prima || '', d.dopo || '');
      if (Object.keys(patch).some(function (k) { return CAL_FIELDS.indexOf(k) >= 0; })) { Giorni.riallinea(row, user.email); Turni.riallinea(row, user.email); }
      if (patch.descrizione !== undefined) Staff.ricalcolaSicuro_();
      return get(user, { id: row.id });
    });
  }

  function setStato(user, p) {
    Users.require(user, 'cestinare');
    var stato = String(p && p.stato || '');
    if (STATI_EVENTO.indexOf(stato) < 0) throw new CtrlError('INVALID', 'Stato non valido');
    return Db.withLock(function () {
      var e = Db.find('eventi', 'id', p.id);
      if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
      var prima = e.stato;
      var row = Db.update('eventi', 'id', p.id, { stato: stato, aggiornato_il: Util.nowIso(), aggiornato_da: user.email }, p.versione);
      Storico.log(user.email, row.id, 'evento', 'stato', row.id, prima, stato);
      return get(user, { id: row.id });
    });
  }

  return { list: list, get: get, create: create, update: update, calendario: calendario, patchSync: patchSync, setStato: setStato, CAL_FIELDS: CAL_FIELDS, COLORE_DEFAULT: COLORE_DEFAULT };
})();
