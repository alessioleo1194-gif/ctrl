/**
 * CTRL · Sincronizzazione dal Google Calendar (solo lettura del calendario).
 *
 * Finestra: da 30 giorni fa a 365 giorni avanti.
 * - evento nuovo        → creato in CTRL (origine "calendar")
 * - evento cambiato     → aggiornati titolo, date, orari, luogo, descrizione, colore (tranne i dati corretti a mano in CTRL: se il Calendar cambia si segnala)
 * - evento sparito      → stato "annullato" (piano e materiale restano)
 * - evento ricomparso   → di nuovo "attivo"
 * - eventi "archiviati" e manuali non vengono mai toccati.
 */
var CalendarSync = (function () {
  var PAST_DAYS = 30;
  var FUTURE_DAYS = 365;

  // Colori evento di Google Calendar (EventColor 1-11). Fonte: palette standard del Calendar.
  var EVENT_COLORS = {
    '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
    '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
  };

  function keyOf(ev) {
    var id = ev.getId();
    if (ev.isRecurringEvent && ev.isRecurringEvent()) {
      var start = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
      return id + '@' + Util.fmtDate(start);
    }
    return id;
  }

  function fieldsOf(ev, calColor) {
    var f = {};
    f.titolo = Util.text(ev.getTitle(), 200) || '(senza titolo)';
    if (ev.isAllDayEvent()) {
      f.data = Util.fmtDate(ev.getAllDayStartDate());
      var endEx = Util.fmtDate(ev.getAllDayEndDate());
      var last = Util.addDays(endEx, -1);
      f.data_fine = last < f.data ? f.data : last;
      f.ora_inizio = '';
      f.ora_fine = '';
    } else {
      var s = ev.getStartTime(), e = ev.getEndTime();
      f.data = Util.fmtDate(s);
      f.ora_inizio = Util.fmtTime(s);
      f.ora_fine = Util.fmtTime(e);
      var endDay = Util.fmtDate(e);
      if (f.ora_fine === '00:00' && endDay > f.data) endDay = Util.addDays(endDay, -1);
      f.data_fine = endDay < f.data ? f.data : endDay;
    }
    f.luogo = Util.text(ev.getLocation(), 200);
    f.descrizione = Util.text(Util.stripHtml(ev.getDescription()), 5000);
    var c = String(ev.getColor() || '');
    f.colore = (EVENT_COLORS[c] || (Util.isColor(calColor) ? calColor : Events.COLORE_DEFAULT)).toLowerCase();
    return f;
  }

  function run(actorEmail) {
    var calId = Config.require('CALENDAR_ID');
    var cal = CalendarApp.getCalendarById(calId);
    if (!cal) throw new CtrlError('SERVER', 'Calendario non raggiungibile: controlla CALENDAR_ID e i permessi.');
    var calColor = String(cal.getColor() || '');
    var now = new Date();
    var from = new Date(now.getTime() - PAST_DAYS * 86400000);
    var to = new Date(now.getTime() + FUTURE_DAYS * 86400000);
    var fromIso = Util.fmtDate(from), toIso = Util.fmtDate(to);
    var events = cal.getEvents(from, to);

    return Db.withLock(function () {
      var stamp = Util.nowIso();
      var byKey = {};
      Db.all('eventi').forEach(function (r) { if (r.origine === 'calendar' && r.cal_key) byKey[r.cal_key] = r; });
      var seen = {};
      var res = { creati: 0, aggiornati: 0, annullati: 0, riattivati: 0, letti: events.length };

      events.forEach(function (ev) {
        var key = keyOf(ev);
        if (seen[key]) return;
        seen[key] = true;
        var f = fieldsOf(ev, calColor);
        var row = byKey[key];
        if (!row) {
          f.id = Util.newId('ev');
          f.origine = 'calendar';
          f.cal_key = key;
          f.stato = 'attivo';
          f.note = '';
          f.creato_il = stamp; f.creato_da = 'calendar';
          f.aggiornato_il = stamp; f.aggiornato_da = 'calendar';
          f.versione = '1';
          f.sync_il = stamp;
          var nuovo = Db.insert('eventi', f);
          Giorni.riallinea(nuovo, 'calendar');
          res.creati++;
          return;
        }
        var patch = Events.patchSync(row, f);   // i dati corretti a mano in CTRL non si toccano
        var rigaFinale = row;
        var reactivate = row.stato === 'annullato';
        if (reactivate) patch.stato = 'attivo';
        if (Object.keys(patch).length) {
          var before = JSON.parse(JSON.stringify(row));
          patch.aggiornato_il = stamp; patch.aggiornato_da = 'calendar'; patch.sync_il = stamp;
          var after = Db.update('eventi', 'id', row.id, patch);
          rigaFinale = after;
          var d = Storico.diff(before, after, Events.CAL_FIELDS.concat(['stato']));
          if (d.changed) Storico.log('calendar', row.id, 'evento', reactivate ? 'riattivato' : 'sync', row.id, d.prima, d.dopo);
          if (reactivate) res.riattivati++; else res.aggiornati++;
        }
        // giornate e turni seguono le date del Calendar (gli orari corretti a mano restano, con la segnalazione)
        if (Giorni.riallinea(rigaFinale, 'calendar')) res.giornate = (res.giornate || 0) + 1;
        Turni.riallinea(rigaFinale, 'calendar');
      });

      Object.keys(byKey).forEach(function (key) {
        var row = byKey[key];
        if (seen[key] || row.stato !== 'attivo') return;
        // Solo eventi che cadono nella finestra letta: quelli più vecchi restano come sono.
        if (row.data < fromIso || row.data > toIso) return;
        Db.update('eventi', 'id', row.id, { stato: 'annullato', aggiornato_il: stamp, aggiornato_da: 'calendar', sync_il: stamp });
        Storico.log('calendar', row.id, 'evento', 'annullato', row.id, 'attivo', 'annullato');
        res.annullati++;
      });

      // le descrizioni cambiate possono nominare persone dello staff: nascono (o decadono) le proposte
      var prop = Staff.ricalcolaSicuro_();
      if (prop) res.proposte = prop.nuove;

      Settings.setRaw('sync_ultimo', stamp);
      Settings.setRaw('sync_esito', res);
      if (actorEmail) Storico.log(actorEmail, '', 'sync', 'manuale', '', '', res);
      return res;
    });
  }

  return { run: run, EVENT_COLORS: EVENT_COLORS };
})();
