/**
 * CTRL · Turni: chi lavora in quale giornata, con quale orario, e se è già impegnato altrove.
 *
 * - Un TURNO è una riga per tecnico e per giornata (tabella `turni`). Lo creano le assegnazioni confermate:
 *   "tutte le giornate" (giorni_tutti) oppure solo quelle scelte. È anche la base dello Staff Work Report.
 * - Orario del turno = il suo, se l'Owner lo ha scritto, altrimenti quello della giornata. Sempre orari PIANIFICATI.
 * - Controllo disponibilità (solo Owner, mai bloccante). Per ogni giornata, rispetto agli altri turni confermati
 *   di eventi non annullati della stessa persona:
 *     sovrapposizione  orari che si incrociano (anche a cavallo della mezzanotte)   → rosso
 *     da_verificare    stessa data, ma manca un orario                               → arancione
 *     stesso_giorno    stessa data, orari che non si toccano                         → azzurro
 *     (nulla)          libero
 *   Due turni che si toccano soltanto (uno finisce alle 23:00, l'altro inizia alle 23:00) non si sovrappongono.
 * - Nessuna riga si cancella: `eliminato`.
 */
var Turni = (function () {
  var RANGO = { sovrapposizione: 3, da_verificare: 2, stesso_giorno: 1 };
  var MAX_ALTRI = 6;

  function attivo(r) { return !Util.bool(r.eliminato); }

  function utentiPerEmail_() {
    var m = {};
    Db.all('utenti').forEach(function (u) { m[Util.normEmail(u.email)] = u; });
    return m;
  }

  function nomeUtente_(m, email) {
    var u = m[email];
    return u ? Staff.nomeDi(u) : String(email).split('@')[0];
  }

  /** Turno con orari effettivi e intervallo assoluto. */
  function arricchisci_(t, g, e) {
    var i = t.ora_inizio || g.ora_inizio || '', f = t.ora_fine || g.ora_fine || '';
    return { t: t, g: g, e: e, email: t.email, data: g.data, ora_inizio: i, ora_fine: f, iv: Giorni.intervallo(g.data, i, f) };
  }

  function carica_() {
    var ev = {}, gi = {};
    Db.all('eventi').forEach(function (e) { ev[e.id] = e; });
    Db.all('giorni').forEach(function (g) { if (attivo(g)) gi[g.id] = g; });
    var out = [];
    Db.all('turni').forEach(function (t) {
      if (!attivo(t)) return;
      var g = gi[t.giorno_id], e = ev[t.evento_id];
      if (g && e) out.push(arricchisci_(t, g, e));
    });
    return out;
  }

  /** Livello di conflitto fra due impegni della stessa persona (null = nessuno). */
  function confronta_(a, b) {
    if (a.iv && b.iv && a.iv.s < b.iv.e && b.iv.s < a.iv.e) return 'sovrapposizione';
    if (a.data === b.data) return a.iv && b.iv ? 'stesso_giorno' : 'da_verificare';
    return null;
  }

  function altro_(o, livello) {
    return { evento_id: o.e.id, titolo: o.e.titolo, data: o.data, ora_inizio: o.ora_inizio, ora_fine: o.ora_fine, livello: livello };
  }

  function aggiungi_(res, o, livello) {
    if (!res.livello || RANGO[livello] > RANGO[res.livello]) res.livello = livello;
    res.altri.push(altro_(o, livello));
  }

  /** Analisi di tutti i turni attivi: conflitti per turno, per evento. */
  function analizza() {
    var tutti = carica_();
    var perEmail = {};
    tutti.forEach(function (x) {
      if (x.e.stato === 'annullato') return;
      (perEmail[x.email] = perEmail[x.email] || []).push(x);
    });
    var livelli = {};
    var res = function (x) { return livelli[x.t.id] || (livelli[x.t.id] = { livello: null, altri: [] }); };
    Object.keys(perEmail).forEach(function (em) {
      var l = perEmail[em].sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
      for (var i = 0; i < l.length; i++) {
        for (var j = i + 1; j < l.length; j++) {
          if (Util.dayNum(l[j].data) - Util.dayNum(l[i].data) > 1) break;
          var lv = confronta_(l[i], l[j]);
          if (!lv) continue;
          aggiungi_(res(l[i]), l[j], lv);
          aggiungi_(res(l[j]), l[i], lv);
        }
      }
    });
    return {
      tutti: tutti,
      livello: function (turnoId) { return livelli[turnoId] || { livello: null, altri: [] }; },
      sovrapposizioniEvento: function (eventoId) {
        var n = 0;
        tutti.forEach(function (x) { if (x.e.id === eventoId && x.e.stato !== 'annullato' && livelli[x.t.id] && livelli[x.t.id].livello === 'sovrapposizione') n++; });
        return n;
      }
    };
  }

  /** Disponibilità di una persona nelle giornate indicate di un evento (anche se non ancora assegnata). */
  function valuta_(email, giorniRows, tutti) {
    var miei = tutti.filter(function (x) { return x.email === email && x.e.stato !== 'annullato'; });
    return giorniRows.map(function (g) {
      var proprio = miei.filter(function (x) { return x.g.id === g.id; })[0];
      var ora = proprio ? { data: g.data, iv: proprio.iv } : { data: g.data, iv: Giorni.intervallo(g.data, g.ora_inizio, g.ora_fine) };
      var res = { livello: null, altri: [] };
      miei.forEach(function (o) {
        if (o.g.id === g.id) return;
        var lv = confronta_(ora, o);
        if (lv) aggiungi_(res, o, lv);
      });
      res.altri = res.altri.slice(0, MAX_ALTRI);
      return { giorno_id: g.id, data: g.data, ora_inizio: proprio ? proprio.ora_inizio : g.ora_inizio, ora_fine: proprio ? proprio.ora_fine : g.ora_fine,
        livello: res.livello, altri: res.altri };
    });
  }

  function peggiore_(lista) {
    var best = null;
    lista.forEach(function (x) { if (x.livello && (!best || RANGO[x.livello] > RANGO[best])) best = x.livello; });
    return best;
  }

  // ---------- lettura per le viste ----------
  function perGiorno() {
    var by = {};
    Db.all('turni').forEach(function (t) { if (attivo(t)) (by[t.giorno_id] = by[t.giorno_id] || []).push(t); });
    return { by: by, utenti: utentiPerEmail_() };
  }

  /** Persone di una giornata. L'Owner vede anche email, orari del turno e conflitti. */
  function staffGiorno(giornoId, idx, owner, analisi) {
    var righe = idx.by[giornoId] || [];
    return righe.map(function (t) {
      var u = idx.utenti[t.email] || { email: t.email, nome: '' };
      var v = { id: u.id || '', nome: Staff.nomeDi(u), colore: Users.coloreDi(u) };
      if (owner) {
        v.email = t.email; v.turno_id = t.id; v.propri_inizio = t.ora_inizio; v.propri_fine = t.ora_fine; v.nota = t.nota;
        var l = analisi ? analisi.livello(t.id) : { livello: null, altri: [] };
        v.livello = l.livello; v.conflitti = l.altri.slice(0, MAX_ALTRI);
      }
      return v;
    }).sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : a.nome.toLowerCase() > b.nome.toLowerCase() ? 1 : 0; });
  }

  /** Turni di una persona in un evento (scheda Staff dell'Owner). */
  function perPersona(e, email, analisi) {
    var giorni = Giorni.attive(e.id);
    var turni = {};
    Db.all('turni').forEach(function (t) { if (t.evento_id === e.id && t.email === email && attivo(t)) turni[t.giorno_id] = t; });
    var out = [];
    giorni.forEach(function (g, i) {
      var t = turni[g.id];
      if (!t) return;
      var x = arricchisci_(t, g, e);
      var l = analisi.livello(t.id);
      out.push({ turno_id: t.id, giorno_id: g.id, n: i + 1, di: giorni.length, data: g.data, ora_inizio: x.ora_inizio, ora_fine: x.ora_fine,
        propri_inizio: t.ora_inizio, propri_fine: t.ora_fine, nota: t.nota, versione: t.versione,
        dopo_mezzanotte: Giorni.dopoMezzanotte(x.ora_inizio, x.ora_fine), livello: l.livello, conflitti: l.altri.slice(0, MAX_ALTRI) });
    });
    return out;
  }

  /** Disponibilità dei candidati (utenti non ancora assegnati) per le giornate di un evento. */
  function perCandidati(e, emails, tutti) {
    var giorni = Giorni.attive(e.id);
    var out = {};
    emails.forEach(function (em) {
      var gg = valuta_(em, giorni, tutti);
      out[em] = { livello: peggiore_(gg), giorni: gg.map(function (x) { return { giorno_id: x.giorno_id, livello: x.livello }; }) };
    });
    return out;
  }

  // ---------- scrittura ----------
  function indice_(eventoId) {
    var m = {};
    Db.all('turni').forEach(function (t) {
      if (t.evento_id !== eventoId) return;
      var k = t.email + '|' + t.giorno_id;
      if (!m[k] || (attivo(t) && !attivo(m[k]))) m[k] = t;
    });
    return m;
  }

  function assicura_(e, email, g, autore, stamp, idx) {
    var k = email + '|' + g.id;
    var t = idx[k];
    if (t) {
      if (attivo(t)) return false;
      idx[k] = Db.update('turni', 'id', t.id, { eliminato: '', ora_inizio: '', ora_fine: '', nota: '', aggiornato_il: stamp, aggiornato_da: autore });
      return true;
    }
    idx[k] = Db.insert('turni', {
      id: Util.newId('tu'), evento_id: e.id, giorno_id: g.id, email: email, ora_inizio: '', ora_fine: '', nota: '', eliminato: '',
      creato_il: stamp, creato_da: autore, aggiornato_il: stamp, aggiornato_da: autore, versione: '1'
    });
    return true;
  }

  function togli_(t, autore, stamp) {
    if (!attivo(t)) return false;
    Db.update('turni', 'id', t.id, { eliminato: 'TRUE', aggiornato_il: stamp, aggiornato_da: autore });
    return true;
  }

  /**
   * Allinea i turni di un evento a giornate e assegnazioni. Da chiamare dentro Db.withLock.
   * Giornate tolte → turni tolti; assegnati a "tutte le giornate" → un turno per ogni giornata attiva.
   */
  function riallinea(e, autore) {
    autore = autore || 'sistema';
    var stamp = Util.nowIso();
    var giorni = Giorni.attive(e.id);
    var vive = {};
    giorni.forEach(function (g) { vive[g.id] = true; });
    var idx = indice_(e.id);
    var cambiato = false;
    Object.keys(idx).forEach(function (k) {
      if (!vive[idx[k].giorno_id] && togli_(idx[k], autore, stamp)) cambiato = true;
    });
    Db.all('assegnazioni').forEach(function (r) {
      if (r.evento_id !== e.id || r.stato !== 'confermata' || r.giorni_tutti === 'FALSE') return;
      giorni.forEach(function (g) { if (assicura_(e, r.email, g, autore, stamp, idx)) cambiato = true; });
    });
    return cambiato;
  }

  /** Giornate scelte per un'assegnazione: null = tutte; altrimenti elenco di id validi. Rifiuta scelte vuote. */
  function normalizzaGiorni(e, ids) {
    if (ids === undefined || ids === null) return null;
    if (!Array.isArray(ids)) throw new CtrlError('INVALID', 'Giornate non valide');
    var giorni = Giorni.attive(e.id);
    var sel = {};
    ids.forEach(function (id) { sel[String(id)] = true; });
    var validi = giorni.filter(function (g) { return sel[g.id]; });
    if (!validi.length) throw new CtrlError('INVALID', 'Scegli almeno una giornata');
    if (validi.length === giorni.length) return null;
    return validi.map(function (g) { return g.id; });
  }

  /** Imposta le giornate di una persona già confermata sull'evento. `ids` già normalizzato (null = tutte). */
  function imposta_(e, email, ids, autore) {
    var stamp = Util.nowIso();
    var riga = Db.all('assegnazioni').filter(function (r) { return r.evento_id === e.id && r.email === email; })[0];
    if (!riga) throw new CtrlError('NOT_FOUND', 'Assegnazione non trovata');
    Db.update('assegnazioni', 'id', riga.id, { giorni_tutti: ids ? 'FALSE' : 'TRUE' });
    var sel = null;
    if (ids) { sel = {}; ids.forEach(function (id) { sel[id] = true; }); }
    var idx = indice_(e.id);
    Giorni.attive(e.id).forEach(function (g) {
      if (!sel || sel[g.id]) assicura_(e, email, g, autore, stamp, idx);
      else if (idx[email + '|' + g.id]) togli_(idx[email + '|' + g.id], autore, stamp);
    });
  }

  /** Toglie tutti i turni di una persona in un evento (assegnazione rimossa dall'Owner). */
  function togli(eventoId, email, autore) {
    var stamp = Util.nowIso(), n = 0;
    Db.all('turni').forEach(function (t) {
      if (t.evento_id === eventoId && t.email === email && togli_(t, autore, stamp)) n++;
    });
    return n;
  }

  /** Utente eliminato: spariscono i turni da oggi in poi, lo storico delle giornate già svolte resta. */
  function togliFuturi(email, autore) {
    var stamp = Util.nowIso(), oggi = Util.today(), n = 0;
    var gi = {};
    Db.all('giorni').forEach(function (g) { gi[g.id] = g; });
    Db.all('turni').forEach(function (t) {
      var g = gi[t.giorno_id];
      if (t.email === email && g && g.data >= oggi && togli_(t, autore, stamp)) n++;
    });
    return n;
  }

  /** Cambio email di un utente. */
  function rinomina(vecchia, nuova, autore) {
    var stamp = Util.nowIso();
    Db.all('turni').forEach(function (t) {
      if (t.email === vecchia) Db.update('turni', 'id', t.id, { email: nuova, aggiornato_il: stamp, aggiornato_da: autore });
    });
  }

  /** Allinea tutti gli eventi (migrazione). */
  function riallineaTutti(autore) {
    var n = 0;
    Db.all('eventi').forEach(function (e) {
      if (Giorni.riallinea(e, autore)) n++;
      Turni.riallinea(e, autore);
    });
    return n;
  }

  // ---------- azioni dell'Owner ----------
  function eventoDi_(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  function orario_(v, etichetta) {
    var t = v === undefined || v === null ? '' : String(v).trim();
    if (t && !Util.isTime(t)) throw new CtrlError('INVALID', etichetta + ' non valido');
    return t;
  }

  /** Orario e nota di un turno. Orari vuoti = come la giornata. */
  function salva(actor, p) {
    Users.require(actor, 'impostazioni');
    p = p || {};
    var e = eventoDi_(p.evento_id);
    var email = Util.normEmail(p.email);
    var g = Db.find('giorni', 'id', String(p.giorno_id || ''));
    if (!g || !attivo(g) || g.evento_id !== e.id) throw new CtrlError('NOT_FOUND', 'Giornata non trovata');
    var inizio = orario_(p.ora_inizio, 'Orario di inizio'), fine = orario_(p.ora_fine, 'Orario di fine');
    if (inizio && fine && inizio === fine) throw new CtrlError('INVALID', 'Inizio e fine coincidono');
    var nota = Util.text(p.nota, 500);
    Db.withLock(function () {
      var t = Db.all('turni').filter(function (x) { return x.evento_id === e.id && x.giorno_id === g.id && x.email === email && attivo(x); })[0];
      if (!t) throw new CtrlError('NOT_FOUND', 'Questa persona non lavora in questa giornata');
      var prima = JSON.parse(JSON.stringify(t));
      var row = Db.update('turni', 'id', t.id, { ora_inizio: inizio, ora_fine: fine, nota: nota, aggiornato_il: Util.nowIso(), aggiornato_da: actor.email }, p.versione);
      var d = Storico.diff(prima, row, ['ora_inizio', 'ora_fine', 'nota']);
      if (d.changed) { d.prima.giorno = g.data; d.prima.persona = email; Storico.log(actor.email, e.id, 'turno', 'modifica', row.id, d.prima, d.dopo); }
    });
    // come staff.gestisci: insieme alla lista c'è l'evento aggiornato, così il frontend non lo rilegge
    var out = Staff.lista(actor, { evento_id: e.id });
    out.evento = Events.get(actor, { id: e.id });
    return out;
  }

  /** Controllo disponibilità prima di assegnare: per ogni giornata dice se la persona è libera. Non scrive nulla. */
  function verifica(actor, p) {
    Users.require(actor, 'impostazioni');
    p = p || {};
    var e = eventoDi_(p.evento_id);
    var email = Util.normEmail(p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    var giorni = Giorni.attive(e.id);
    var scelti = normalizzaGiorni(e, p.giorni);
    if (scelti) giorni = giorni.filter(function (g) { return scelti.indexOf(g.id) >= 0; });
    var tutti = carica_();
    var gg = valuta_(email, giorni, tutti);
    var utenti = utentiPerEmail_();
    return {
      evento_id: e.id, email: email, nome: nomeUtente_(utenti, email), livello: peggiore_(gg),
      giorni: gg.map(function (x, i) { x.n = i + 1; return x; }),
      // "liberi" = nessuna sovrapposizione e nessun orario da verificare (l'azzurro non è un problema)
      liberi: gg.filter(function (x) { return !x.livello || x.livello === 'stesso_giorno'; }).map(function (x) { return x.giorno_id; })
    };
  }

  return {
    analizza: analizza, perGiorno: perGiorno, staffGiorno: staffGiorno, perPersona: perPersona, perCandidati: perCandidati,
    riallinea: riallinea, normalizzaGiorni: normalizzaGiorni, imposta_: imposta_, togli: togli, togliFuturi: togliFuturi,
    rinomina: rinomina, riallineaTutti: riallineaTutti, salva: salva, verifica: verifica, carica_: carica_, RANGO: RANGO
  };
})();
