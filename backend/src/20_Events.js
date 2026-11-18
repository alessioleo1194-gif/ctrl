/**
 * CTRL · Eventi.
 *
 * - origine "calendar": titolo, date, orari, luogo, descrizione e colore arrivano dal
 *   Google Calendar e si modificano lì. In CTRL si aggiungono note e contenuti di produzione.
 * - origine "manuale": creati dall'admin, tutti i campi modificabili in CTRL.
 */
var Events = (function () {
  var CAL_FIELDS = ['titolo', 'data', 'data_fine', 'ora_inizio', 'ora_fine', 'luogo', 'descrizione', 'colore'];
  var COLORE_DEFAULT = '#5b6472';

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
      aggiornato_il: e.aggiornato_il, aggiornato_da: e.aggiornato_da, produzione_id: e.progetto_id || '',
      stato_doc: { piano: c.piano > 0, materiale: c.materiale > 0, scheda: c.scheda > 0 },
      staff: st.staff(e.id), mio: st.mio(e.id), accesso: accesso, da_confermare: st.daConfermare(e.id)
    };
    v.giorni = gi.di(e);
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
    out.produzione = out.accesso && e.progetto_id ? Produzioni.riepilogo(e.progetto_id) : null;
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
      if (e.origine === 'calendar') throw new CtrlError('INVALID', 'Questo evento arriva dal Google Calendar: modificalo lì');
      var f = validateFields(p, true);
      Object.keys(f).forEach(function (k) { patch[k] = f[k]; });
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

  return { list: list, get: get, create: create, update: update, setStato: setStato, CAL_FIELDS: CAL_FIELDS, COLORE_DEFAULT: COLORE_DEFAULT };
})();
