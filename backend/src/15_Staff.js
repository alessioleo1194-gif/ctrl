/**
 * CTRL · Staff assegnato agli eventi.
 *
 * - Un'assegnazione collega una persona (utente) a un evento. Solo l'OWNER assegna.
 * - Dalle descrizioni del Calendar nascono PROPOSTE: CTRL cerca nel testo il "nome in calendario" di ogni utente
 *   attivo (parola intera, senza maiuscole né accenti). Una proposta non vale nulla finché l'OWNER non la conferma.
 * - Le assegnazioni confermate o manuali non cambiano con la sincronizzazione. Una proposta scartata resta scartata.
 * - Chi non è assegnato vede l'evento ma non i suoi documenti: Production Plan, Material List, file e note.
 *   Per le produzioni con più eventi (festival) basta essere assegnati a uno degli eventi della produzione.
 *
 * stato: proposta · confermata · scartata (non è lui) · rimossa (tolta a mano) · decaduta (il nome non c'è più)
 */
var Staff = (function () {
  var FINESTRA_GIORNI = 30;
  var CONTESTO = 24;

  // ---------- ricerca dei nomi nel testo ----------
  function senzaAccenti(s) {
    var t = String(s || '');
    try { t = t.normalize('NFD'); } catch (e) { /* ambiente senza normalize */ }
    return t.replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** Parole del testo con la loro posizione: lettere e cifre latine, accentate comprese. */
  function parole(testo) {
    var out = [], re = /[A-Za-z0-9À-ɏ]+/g, m;
    while ((m = re.exec(testo)) !== null) out.push({ n: senzaAccenti(m[0]), start: m.index, end: m.index + m[0].length });
    return out;
  }

  /** Alias di un utente: "nome in calendario" separato da virgole; se vuoto, il primo nome (almeno 3 lettere). */
  function alias(u) {
    var elenco = String(u.nome_calendario || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!elenco.length) {
      var primo = String(u.nome || '').trim().split(/\s+/)[0];
      if (primo && senzaAccenti(primo).length >= 3) elenco = [primo];
    }
    return elenco.map(function (a) { return parole(a).map(function (w) { return w.n; }); })
      .filter(function (a) { return a.length && a.join('').length >= 2; });
  }

  function cerca(testoParole, aliasUtente) {
    for (var k = 0; k < aliasUtente.length; k++) {
      var a = aliasUtente[k];
      for (var i = 0; i + a.length <= testoParole.length; i++) {
        var ok = true;
        for (var j = 0; j < a.length; j++) if (testoParole[i + j].n !== a[j]) { ok = false; break; }
        if (ok) return { da: testoParole[i].start, a: testoParole[i + a.length - 1].end };
      }
    }
    return null;
  }

  function frammento(testo, da, a) {
    var s = Math.max(0, da - CONTESTO), e = Math.min(testo.length, a + CONTESTO);
    var f = testo.slice(s, e).replace(/\s+/g, ' ');
    var termine = testo.slice(da, a);
    return { trovato: Util.text((s > 0 ? '…' : '') + f + (e < testo.length ? '…' : ''), 160), termine: Util.text(termine, 80) };
  }

  /** Utenti che possono essere assegnati: attivi e non scaduti. */
  function utentiAttivi() {
    return Db.all('utenti').filter(function (u) {
      return !Util.bool(u.eliminato) && (Util.bool(u.attivo) || Util.normEmail(u.email) === Users.adminEmail()) && !Users.scaduto(u);
    });
  }

  function trovaNomi(e, attivi) {
    var out = {};
    var testo = String(e.descrizione || '');
    if (!testo) return out;
    var w = parole(testo);
    attivi.forEach(function (u) {
      var m = cerca(w, alias(u));
      if (m) out[Util.normEmail(u.email)] = frammento(testo, m.da, m.a);
    });
    return out;
  }

  function perEvento() {
    var out = {};
    Db.all('assegnazioni').forEach(function (r) {
      if (!out[r.evento_id]) out[r.evento_id] = {};
      out[r.evento_id][r.email] = r;
    });
    return out;
  }

  /**
   * Ricalcola le proposte di tutti gli eventi attivi recenti o futuri. Da chiamare dentro Db.withLock.
   * Non tocca assegnazioni confermate né proposte scartate.
   */
  function ricalcola_() {
    var da = Util.addDays(Util.today(), -FINESTRA_GIORNI);
    var attivi = utentiAttivi();
    var righe = perEvento();
    var stamp = Util.nowIso();
    var res = { nuove: 0, aggiornate: 0, decadute: 0 };
    Db.all('eventi').forEach(function (e) {
      if (e.stato !== 'attivo' || (e.data_fine || e.data) < da) return;
      var trovati = trovaNomi(e, attivi);
      var esistenti = righe[e.id] || {};
      Object.keys(trovati).forEach(function (email) {
        var t = trovati[email], r = esistenti[email];
        if (!r) {
          Db.insert('assegnazioni', { id: Util.newId('as'), evento_id: e.id, email: email, stato: 'proposta', origine: 'calendario',
            trovato: t.trovato, termine: t.termine, creata_il: stamp, creata_da: 'calendar', aggiornata_il: stamp, aggiornata_da: 'calendar' });
          Storico.log('calendar', e.id, 'staff', 'proposta', email, '', t.termine);
          res.nuove++;
        } else if (r.stato === 'proposta') {
          if (r.trovato !== t.trovato || r.termine !== t.termine) {
            Db.update('assegnazioni', 'id', r.id, { trovato: t.trovato, termine: t.termine, aggiornata_il: stamp, aggiornata_da: 'calendar' });
            res.aggiornate++;
          }
        } else if (r.stato === 'decaduta' || r.stato === 'rimossa') {
          Db.update('assegnazioni', 'id', r.id, { stato: 'proposta', origine: 'calendario', trovato: t.trovato, termine: t.termine,
            aggiornata_il: stamp, aggiornata_da: 'calendar' });
          Storico.log('calendar', e.id, 'staff', 'proposta', email, r.stato, t.termine);
          res.nuove++;
        }
      });
      Object.keys(esistenti).forEach(function (email) {
        var r = esistenti[email];
        if (r.stato === 'proposta' && !trovati[email]) {
          Db.update('assegnazioni', 'id', r.id, { stato: 'decaduta', aggiornata_il: stamp, aggiornata_da: 'calendar' });
          res.decadute++;
        }
      });
    });
    return res;
  }

  /** Come ricalcola_ ma senza mai far fallire l'operazione che lo chiama. Da chiamare dentro Db.withLock. */
  function ricalcolaSicuro_() {
    try { return ricalcola_(); }
    catch (e) { console.error('CTRL proposte staff non aggiornate', e && e.message || e); return null; }
  }

  // ---------- accesso ai documenti ----------
  /**
   * Cosa può vedere un utente: l'OWNER tutto; gli altri gli eventi a cui sono assegnati (confermati)
   * e quelli che condividono la stessa produzione.
   */
  function contesto(user) {
    if (!user || Users.can(user, 'admin')) return { tutto: true, vede: function () { return true; }, consente: function () { return true; }, produzione: function () { return true; } };
    // permesso particolare "vede tutti i documenti": accesso a ogni evento, ma non è l'Owner (niente proposte da confermare)
    var tuttiDoc = Users.can(user, 'vedereTutto');
    var mie = {}, prod = {};
    var eventi = {};
    Db.all('eventi').forEach(function (e) { eventi[e.id] = e; });
    Db.all('assegnazioni').forEach(function (r) {
      if (r.email !== Util.normEmail(user.email) || r.stato !== 'confermata') return;
      mie[r.evento_id] = true;
      var e = eventi[r.evento_id];
      if (e && e.progetto_id) prod[e.progetto_id] = true;
    });
    // chi ha solo lettura (VIEWER) vede soltanto gli eventi a cui è assegnato, passati compresi; Production e Owner tutti.
    // Il permesso "vede i documenti di tutti gli eventi" apre anche l'elenco.
    var limitato = Users.ruoloDi(user) === 'VIEWER' && !tuttiDoc;
    return {
      tutto: false,
      vede: function (e) { return !!(e && (!limitato || mie[e.id])); },
      assegnato: function (eventoId) { return !!mie[eventoId]; },
      consente: function (e) { return !!(e && (tuttiDoc || mie[e.id] || (e.progetto_id && prod[e.progetto_id]))); },
      produzione: function (pid) { return tuttiDoc || !!prod[pid]; }
    };
  }

  var MSG = 'Documenti, file e note sono riservati allo staff assegnato all\'evento';

  function puoAccedere(user, e) { return contesto(user).consente(e); }
  /** Può vedere l'evento (nome, data, luogo)? Il Viewer solo se assegnato. */
  function puoVedere(user, e) { return contesto(user).vede(e); }
  function richiediEvento(user, e) {
    if (!contesto(user).consente(e)) throw new CtrlError('FORBIDDEN', MSG);
  }
  function richiediProduzione(user, pid) {
    if (!contesto(user).produzione(String(pid || ''))) throw new CtrlError('FORBIDDEN', MSG);
  }

  // ---------- vista per le liste di eventi ----------
  function nomeDi(u) {
    if (Util.normEmail(u.email) === Users.adminEmail()) return Users.nomeOwner(u.nome);
    return String(u.nome || '').trim() || String(u.email || '').split('@')[0];
  }

  /** Strumenti per costruire la lista eventi con una sola lettura delle tabelle. */
  function perLista(user) {
    var ctx = contesto(user);
    var owner = ctx.tutto;
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var conf = {}, prop = {};
    Db.all('assegnazioni').forEach(function (r) {
      if (r.stato === 'confermata') (conf[r.evento_id] = conf[r.evento_id] || []).push(r);
      else if (r.stato === 'proposta') prop[r.evento_id] = (prop[r.evento_id] || 0) + 1;
    });
    var mia = Util.normEmail(user && user.email);
    return {
      accesso: function (e) { return ctx.consente(e); },
      vede: function (e) { return ctx.vede(e); },
      staff: function (eventoId) {
        return (conf[eventoId] || []).slice().sort(function (a, b) { return a.aggiornata_il < b.aggiornata_il ? -1 : a.aggiornata_il > b.aggiornata_il ? 1 : 0; })
          .map(function (r) {
            var u = utenti[r.email] || { email: r.email, nome: '' };
            return { id: u.id || '', nome: nomeDi(u), colore: Users.coloreDi(u) };
          });
      },
      mio: function (eventoId) { return (conf[eventoId] || []).some(function (r) { return r.email === mia; }); },
      daConfermare: function (eventoId) { return owner ? (prop[eventoId] || 0) : 0; }
    };
  }

  // ---------- azioni dell'OWNER ----------
  function vistaPersona(r, u) {
    u = u || { email: r.email, nome: '', ruolo: 'VIEWER' };
    return { email: r.email, nome: u.nome || r.email, ruolo: Users.ruoloDi(u), colore: Users.coloreDi(u),
      origine: r.origine, trovato: r.trovato, termine: r.termine, stato: r.stato };
  }

  function evento_(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }

  /** Staff di un evento per la scheda "Staff" (solo OWNER). */
  function lista(actor, p) {
    Users.require(actor, 'impostazioni');
    var e = evento_(p && p.evento_id);
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var righe = Db.all('assegnazioni').filter(function (r) { return r.evento_id === e.id; })
      .sort(function (a, b) { return a.creata_il < b.creata_il ? -1 : 1; });
    var per = function (stato) {
      return righe.filter(function (r) { return r.stato === stato; }).map(function (r) { return vistaPersona(r, utenti[r.email]); });
    };
    var assegnati = per('confermata');
    var presi = {};
    assegnati.forEach(function (a) { presi[a.email] = true; });
    var candidati = utentiAttivi().filter(function (u) { return !presi[Util.normEmail(u.email)]; })
      .map(function (u) { return { email: u.email, nome: u.nome || u.email, ruolo: Users.ruoloDi(u), colore: Users.coloreDi(u) }; })
      .sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1; });
    return { evento_id: e.id, assegnati: assegnati, proposte: per('proposta'), scartate: per('scartata'), candidati: candidati };
  }

  var AZIONI = ['conferma', 'scarta', 'rimuovi', 'ripristina', 'aggiungi'];

  function gestisci(actor, p) {
    Users.require(actor, 'impostazioni');
    p = p || {};
    var azione = String(p.azione || '');
    if (AZIONI.indexOf(azione) < 0) throw new CtrlError('INVALID', 'Azione non valida');
    var email = Util.normEmail(p.email);
    if (!Util.isEmail(email)) throw new CtrlError('INVALID', 'Email non valida');
    var e = evento_(p.evento_id);
    Db.withLock(function () {
      var riga = (perEvento()[e.id] || {})[email] || null;
      var u = Db.find('utenti', 'email', email);
      var stamp = Util.nowIso();
      var scrivi = function (patch, prima) {
        patch.aggiornata_il = stamp; patch.aggiornata_da = actor.email;
        Db.update('assegnazioni', 'id', riga.id, patch);
        Storico.log(actor.email, e.id, 'staff', azione, email, prima, patch.stato);
      };
      if (azione === 'aggiungi') {
        if (!u || !utentiAttivi().some(function (x) { return Util.normEmail(x.email) === email; })) throw new CtrlError('INVALID', 'Utente non attivo');
        if (riga && riga.stato === 'confermata') return;
        if (riga) scrivi({ stato: 'confermata', origine: 'manuale' }, riga.stato);
        else {
          Db.insert('assegnazioni', { id: Util.newId('as'), evento_id: e.id, email: email, stato: 'confermata', origine: 'manuale',
            creata_il: stamp, creata_da: actor.email, aggiornata_il: stamp, aggiornata_da: actor.email });
          Storico.log(actor.email, e.id, 'staff', 'aggiungi', email, '', 'confermata');
        }
        return;
      }
      if (!riga) throw new CtrlError('NOT_FOUND', 'Assegnazione non trovata');
      if (azione === 'conferma') {
        if (riga.stato !== 'proposta') throw new CtrlError('CONFLICT', 'La proposta non è più in attesa');
        scrivi({ stato: 'confermata' }, riga.stato);
      } else if (azione === 'scarta') {
        if (riga.stato !== 'proposta') throw new CtrlError('CONFLICT', 'La proposta non è più in attesa');
        scrivi({ stato: 'scartata' }, riga.stato);
      } else if (azione === 'rimuovi') {
        if (riga.stato !== 'confermata') throw new CtrlError('CONFLICT', 'La persona non è assegnata');
        // se veniva dal Calendar si ricorda che non era lei, altrimenti la prossima sync la riproporrebbe
        scrivi({ stato: riga.origine === 'calendario' ? 'scartata' : 'rimossa' }, riga.stato);
      } else if (azione === 'ripristina') {
        if (riga.stato !== 'scartata') throw new CtrlError('CONFLICT', 'Niente da ripristinare');
        var trovati = u ? trovaNomi(e, [u]) : {};
        if (!trovati[email]) throw new CtrlError('INVALID', 'Il nome non è più nella descrizione dell\'evento');
        scrivi({ stato: 'proposta', trovato: trovati[email].trovato, termine: trovati[email].termine }, riga.stato);
      }
    });
    return lista(actor, { evento_id: e.id });
  }

  return {
    ricalcola_: ricalcola_, ricalcolaSicuro_: ricalcolaSicuro_, contesto: contesto, puoAccedere: puoAccedere, puoVedere: puoVedere,
    richiediEvento: richiediEvento, richiediProduzione: richiediProduzione, perLista: perLista,
    lista: lista, gestisci: gestisci, alias: alias, MSG: MSG
  };
})();
