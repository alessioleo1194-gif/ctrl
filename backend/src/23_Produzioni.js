/**
 * CTRL · Scheda di produzione (tappa 1: struttura e persone).
 *
 * Una produzione (tabella "progetti") raggruppa uno o più eventi del Calendar
 * (eventi.progetto_id): un concerto ha un evento, un festival ne ha molti.
 * Contiene giornate, spazi (tabella "location") e la squadra, che punta alla
 * rubrica comune "persone".
 *
 * Salvataggio: l'app manda lotti di operazioni (produzione.salva) con id generati
 * da lei, così un nuovo elemento si può modificare subito e un invio ripetuto dopo
 * un errore di rete non crea doppioni. Il lotto si valida tutto prima di scrivere:
 * o passa intero o non scrive nulla. Sullo stesso campo vince l'ultimo salvataggio,
 * ma la risposta segnala chi aveva modificato l'elemento nel frattempo.
 */
var Produzioni = (function () {
  var MAX_OPS = 200;
  var MAX_GIORNATE_AUTO = 31;
  var TIPI_SPAZIO = ['palco', 'sala', 'venue', 'magazzino', 'altro'];
  var PREFISSI = { giornata: 'gio', spazio: 'spa', squadra: 'sq', persona: 'per' };
  var TABELLE = { giornata: 'giornate', spazio: 'location', squadra: 'squadra', persona: 'persone' };

  // Campi modificabili e loro lunghezza massima
  var CAMPI = {
    produzione: { nome: 120, note: 5000 },
    giornata: { data: 10, etichetta: 60, ordine: 6 },
    spazio: { nome: 80, tipo: 20, indirizzo: 200, note: 1000, ordine: 6 },
    squadra: { persona_id: 40, ruolo: 80, giornata_id: 40, spazio_id: 40, note: 500, ordine: 6 },
    persona: { nome: 80, ruolo: 80, telefono: 30, email: 120, azienda: 80, note: 500 }
  };

  function vivo(r) { return r && !Util.bool(r.eliminato); }

  function trova(tabella, id) {
    var r = Db.find(tabella, 'id', id);
    return vivo(r) ? r : null;
  }

  function produzione(id) {
    var p = trova('progetti', id);
    if (!p) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
    return p;
  }

  function giorniEvento(e) {
    var out = [], d = e.data, fine = e.data_fine || e.data;
    while (d <= fine && out.length < MAX_GIORNATE_AUTO) { out.push(d); d = Util.addDays(d, 1); }
    return out;
  }

  function figli(tabella, pid) {
    return Db.all(tabella).filter(function (r) { return r.progetto_id === pid && vivo(r); });
  }

  function perOrdine(a, b) { return (parseInt(a.ordine, 10) || 0) - (parseInt(b.ordine, 10) || 0); }

  function pubblica(r, campi) {
    var o = { id: r.id, versione: r.versione || '1' };
    campi.forEach(function (c) { o[c] = r[c] || ''; });
    return o;
  }

  function personaVista(r) {
    if (!r) return null;
    var o = pubblica(r, ['nome', 'ruolo', 'telefono', 'email', 'azienda', 'note']);
    o.eliminata = Util.bool(r.eliminato);
    return o;
  }

  /** Stato dei blocchi e avvisi: informano, non bloccano mai il salvataggio. */
  function analisi(eventi, giornate, spazi, squadra, persone) {
    var avvisi = [];
    var date = {};
    giornate.forEach(function (g) { date[g.data] = true; });
    eventi.forEach(function (e) {
      if (e.stato === 'annullato') avvisi.push({ blocco: 'struttura', testo: '"' + e.titolo + '" risulta annullato nel Calendar' });
      var mancanti = giorniEvento(e).filter(function (d) { return !date[d]; });
      if (mancanti.length) {
        avvisi.push({ blocco: 'struttura', testo: '"' + e.titolo + '" ha ' + (mancanti.length === 1 ? 'una data' : mancanti.length + ' date') + ' senza giornata: ' + mancanti.join(', ') });
      }
    });
    if (!giornate.length) avvisi.push({ blocco: 'struttura', testo: 'Nessuna giornata' });
    if (!spazi.length) avvisi.push({ blocco: 'struttura', testo: 'Nessuno spazio' });
    if (!squadra.length) avvisi.push({ blocco: 'persone', testo: 'Squadra vuota' });
    squadra.forEach(function (s) {
      var p = persone[s.persona_id];
      if (!p) return;
      if (Util.bool(p.eliminato)) avvisi.push({ blocco: 'persone', testo: p.nome + ' è stato tolto dalla rubrica' });
      else if (!p.telefono) avvisi.push({ blocco: 'persone', testo: p.nome + ': manca il telefono' });
    });
    function stato(n, blocco) {
      if (!n) return 'vuoto';
      return avvisi.some(function (a) { return a.blocco === blocco; }) ? 'in_corso' : 'completo';
    }
    return {
      avvisi: avvisi,
      blocchi: {
        struttura: { stato: giornate.length && spazi.length ? stato(1, 'struttura') : (giornate.length || spazi.length ? 'in_corso' : 'vuoto'), giornate: giornate.length, spazi: spazi.length },
        persone: { stato: stato(squadra.length, 'persone'), squadra: squadra.length }
      }
    };
  }

  function dati(pid) {
    var p = produzione(pid);
    var eventi = Db.all('eventi').filter(function (e) { return e.progetto_id === pid && e.stato !== 'archiviato'; })
      .sort(function (a, b) { return (a.data + a.ora_inizio) < (b.data + b.ora_inizio) ? -1 : 1; });
    var giornate = figli('giornate', pid).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : perOrdine(a, b); });
    var spazi = figli('location', pid).sort(perOrdine);
    var squadra = figli('squadra', pid).sort(perOrdine);
    var persone = {};
    Db.all('persone').forEach(function (r) { persone[r.id] = r; });
    return { p: p, eventi: eventi, giornate: giornate, spazi: spazi, squadra: squadra, persone: persone };
  }

  function vista(user, pid, extra) {
    var d = dati(pid);
    var a = analisi(d.eventi, d.giornate, d.spazi, d.squadra, d.persone);
    var out = {
      id: d.p.id, nome: d.p.nome, tipo: d.p.tipo || 'evento', note: d.p.note || '', versione: d.p.versione || '1',
      aggiornato_il: d.p.aggiornato_il, aggiornato_da: d.p.aggiornato_da,
      eventi: d.eventi.map(function (e) {
        return { id: e.id, titolo: e.titolo, data: e.data, data_fine: e.data_fine || e.data, ora_inizio: e.ora_inizio, ora_fine: e.ora_fine, luogo: e.luogo, stato: e.stato, colore: e.colore || Events.COLORE_DEFAULT };
      }),
      giornate: d.giornate.map(function (g) { return pubblica(g, ['data', 'etichetta', 'ordine']); }),
      spazi: d.spazi.map(function (s) { return pubblica(s, ['nome', 'tipo', 'indirizzo', 'note', 'ordine']); }),
      squadra: d.squadra.map(function (s) {
        var o = pubblica(s, ['persona_id', 'ruolo', 'giornata_id', 'spazio_id', 'note', 'ordine']);
        o.persona = personaVista(d.persone[s.persona_id]);
        return o;
      }),
      blocchi: a.blocchi,
      avvisi: a.avvisi,
      permessi: { modificare: Users.can(user, 'modificare'), admin: Users.can(user, 'admin') }
    };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /** Riepilogo per il dettaglio evento. */
  function riepilogo(pid) {
    var p = trova('progetti', pid);
    if (!p) return null;
    var d = dati(pid);
    var a = analisi(d.eventi, d.giornate, d.spazi, d.squadra, d.persone);
    return { id: p.id, nome: p.nome, tipo: p.tipo || 'evento', eventi: d.eventi.length, blocchi: a.blocchi, avvisi: a.avvisi.length };
  }

  function get(user, p) {
    return vista(user, String(p && p.id || ''));
  }

  /** Allinea data e data_fine della produzione alle sue giornate (servono agli elenchi). */
  function aggiornaDate(pid, user) {
    var g = figli('giornate', pid).map(function (r) { return r.data; }).sort();
    var p = produzione(pid);
    var patch = { data: g[0] || '', data_fine: g[g.length - 1] || '' };
    if (patch.data !== (p.data || '') || patch.data_fine !== (p.data_fine || '')) Db.update('progetti', 'id', pid, patch, null, true);
    void user;
  }

  function aggiungiGiornate(pid, e, now, user) {
    var esistenti = {};
    figli('giornate', pid).forEach(function (g) { esistenti[g.data] = true; });
    var n = 0;
    giorniEvento(e).forEach(function (d) {
      if (esistenti[d]) return;
      Db.insert('giornate', { id: Util.newId('gio'), progetto_id: pid, data: d, etichetta: '', ordine: '0', eliminato: 'FALSE',
        creato_il: now, aggiornato_il: now, aggiornato_da: user.email, versione: '1' });
      n++;
    });
    return n;
  }

  /** Crea la scheda di un evento: giornate dalle sue date, uno spazio dal suo luogo. */
  function crea(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var e = Db.find('eventi', 'id', p && p.evento_id);
      if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
      if (e.progetto_id && trova('progetti', e.progetto_id)) return vista(user, e.progetto_id);
      var now = Util.nowIso();
      var pid = Util.newId('pr');
      Db.insert('progetti', { id: pid, nome: Util.text(e.titolo, 120) || 'Produzione', tipo: 'evento', stato: 'attivo',
        creato_il: now, creato_da: user.email, aggiornato_il: now, aggiornato_da: user.email, versione: '1', eliminato: 'FALSE', note: '' });
      Db.update('eventi', 'id', e.id, { progetto_id: pid }, null, true);
      aggiungiGiornate(pid, e, now, user);
      var luogo = Util.text(e.luogo, 200);
      Db.insert('location', { id: Util.newId('spa'), progetto_id: pid, nome: luogo ? Util.text(luogo.split(',')[0], 80) : 'Spazio principale',
        indirizzo: luogo, note: '', tipo: 'venue', ordine: '1', eliminato: 'FALSE', creato_il: now, aggiornato_il: now,
        aggiornato_da: user.email, versione: '1' });
      aggiornaDate(pid, user);
      Storico.log(user.email, e.id, 'produzione', 'crea', pid, '', { nome: e.titolo });
      return vista(user, pid);
    });
  }

  /** Aggiunge un altro evento alla stessa produzione (festival). */
  function collega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pid = produzione(p && p.id).id;
      var e = Db.find('eventi', 'id', p && p.evento_id);
      if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
      if (e.progetto_id === pid) return vista(user, pid);
      if (e.progetto_id && trova('progetti', e.progetto_id)) throw new CtrlError('INVALID', 'Questo evento fa già parte di un\'altra scheda di produzione');
      var now = Util.nowIso();
      Db.update('eventi', 'id', e.id, { progetto_id: pid }, null, true);
      aggiungiGiornate(pid, e, now, user);
      Db.update('progetti', 'id', pid, { tipo: 'festival', aggiornato_il: now, aggiornato_da: user.email });
      aggiornaDate(pid, user);
      Storico.log(user.email, e.id, 'produzione', 'collega', pid, '', { evento: e.titolo });
      return vista(user, pid);
    });
  }

  /** Toglie un evento dalla produzione; le giornate restano (si tolgono a mano se non servono). */
  function scollega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pid = produzione(p && p.id).id;
      var e = Db.find('eventi', 'id', p && p.evento_id);
      if (!e || e.progetto_id !== pid) throw new CtrlError('NOT_FOUND', 'Evento non collegato a questa scheda');
      var collegati = Db.all('eventi').filter(function (x) { return x.progetto_id === pid; });
      if (collegati.length <= 1) throw new CtrlError('INVALID', 'Una scheda di produzione deve avere almeno un evento');
      Db.update('eventi', 'id', e.id, { progetto_id: '' }, null, true);
      Storico.log(user.email, e.id, 'produzione', 'scollega', pid, { evento: e.titolo }, '');
      return vista(user, pid);
    });
  }

  // ---------- salvataggio a lotti ----------

  function pulisci(tipo, campi, isNew) {
    var def = CAMPI[tipo];
    var out = {};
    Object.keys(campi || {}).forEach(function (k) {
      if (!(k in def)) throw new CtrlError('INVALID', 'Campo non valido: ' + k);
      // date e id non si troncano: un valore troppo lungo è un errore, non un valore da accorciare
      if ((k === 'data' || /_id$/.test(k)) && String(campi[k] == null ? '' : campi[k]).length > def[k]) throw new CtrlError('INVALID', 'Valore non valido: ' + k);
      out[k] = Util.text(campi[k], def[k]);
    });
    if (tipo === 'giornata' && 'data' in out && !Util.isDate(out.data)) throw new CtrlError('INVALID', 'Data della giornata non valida');
    if (tipo === 'giornata' && isNew && !out.data) throw new CtrlError('INVALID', 'La giornata deve avere una data');
    if (tipo === 'spazio' && ((isNew && !out.nome) || ('nome' in out && !out.nome))) throw new CtrlError('INVALID', 'Lo spazio deve avere un nome');
    if (tipo === 'spazio' && out.tipo && TIPI_SPAZIO.indexOf(out.tipo) < 0) throw new CtrlError('INVALID', 'Tipo di spazio non valido');
    if (tipo === 'persona' && ((isNew && !out.nome) || ('nome' in out && !out.nome))) throw new CtrlError('INVALID', 'La persona deve avere un nome');
    if (tipo === 'persona' && out.email && !Util.isEmail(out.email)) throw new CtrlError('INVALID', 'Email non valida: ' + out.email);
    if (tipo === 'produzione' && 'nome' in out && !out.nome) throw new CtrlError('INVALID', 'La scheda deve avere un nome');
    if ('ordine' in out && out.ordine && !/^\d{1,6}$/.test(out.ordine)) throw new CtrlError('INVALID', 'Ordine non valido');
    if (tipo === 'squadra' && isNew && !out.persona_id) throw new CtrlError('INVALID', 'Scegli una persona');
    return out;
  }

  function idValido(tipo, id) {
    return typeof id === 'string' && new RegExp('^' + PREFISSI[tipo] + '_[a-z0-9]{8,24}$').test(id);
  }

  /**
   * Applica un lotto di operazioni. Ogni operazione:
   * { tipo: 'produzione'|'giornata'|'spazio'|'squadra'|'persona', azione: 'crea'|'modifica'|'elimina',
   *   id, campi: {...}, versione: '<versione letta>' (facoltativa) }
   */
  function salva(user, p) {
    Users.require(user, 'modificare');
    p = p || {};
    var ops = p.ops;
    if (!Array.isArray(ops) || !ops.length) throw new CtrlError('INVALID', 'Nessuna modifica');
    if (ops.length > MAX_OPS) throw new CtrlError('INVALID', 'Troppe modifiche in un solo salvataggio');

    return Db.withLock(function () {
      var pid = produzione(p.id).id;
      var now = Util.nowIso();
      var piano = [];
      // stato simulato per validare il lotto prima di scrivere
      var appartiene = { giornata: {}, spazio: {}, squadra: {} };
      ['giornata', 'spazio', 'squadra'].forEach(function (t) {
        figli(TABELLE[t], pid).forEach(function (r) { appartiene[t][r.id] = r; });
      });
      var persone = {};
      Db.all('persone').forEach(function (r) { if (vivo(r)) persone[r.id] = r; });
      var dateUsate = {};
      Object.keys(appartiene.giornata).forEach(function (id) { dateUsate[appartiene.giornata[id].data] = id; });

      ops.forEach(function (op, i) {
        var where = ' (modifica ' + (i + 1) + ')';
        if (!op || typeof op !== 'object') throw new CtrlError('INVALID', 'Modifica non valida' + where);
        var tipo = op.tipo, azione = op.azione;
        if (!(tipo in CAMPI)) throw new CtrlError('INVALID', 'Tipo non valido' + where);
        if (['crea', 'modifica', 'elimina'].indexOf(azione) < 0) throw new CtrlError('INVALID', 'Azione non valida' + where);
        if (tipo === 'produzione') {
          if (azione !== 'modifica') throw new CtrlError('INVALID', 'Azione non valida sulla scheda' + where);
          piano.push({ tipo: tipo, azione: azione, id: pid, campi: pulisci(tipo, op.campi, false), versione: op.versione });
          return;
        }
        if (tipo === 'persona' && azione === 'elimina') throw new CtrlError('FORBIDDEN', 'Le persone si tolgono dalla rubrica dalle impostazioni');
        if (!idValido(tipo, op.id)) throw new CtrlError('INVALID', 'Identificativo non valido' + where);
        var esiste = tipo === 'persona' ? persone[op.id] : appartiene[tipo][op.id];
        var crea = azione === 'crea' && !esiste; // un "crea" ripetuto diventa una modifica: nessun doppione
        if (azione !== 'crea' && !esiste) throw new CtrlError('NOT_FOUND', 'Elemento non trovato, forse già tolto' + where);
        if (azione === 'crea' && !esiste) {
          // l'id non deve appartenere a un'altra produzione
          var altrove = Db.find(TABELLE[tipo], 'id', op.id);
          if (altrove) throw new CtrlError('INVALID', 'Identificativo già usato' + where);
        }
        var campi = azione === 'elimina' ? {} : pulisci(tipo, op.campi, crea);
        if (tipo === 'giornata' && azione === 'elimina' && esiste && dateUsate[esiste.data] === op.id) delete dateUsate[esiste.data];
        if (tipo === 'giornata' && campi.data) {
          var gia = dateUsate[campi.data];
          if (gia && gia !== op.id) throw new CtrlError('INVALID', 'C\'è già una giornata il ' + campi.data);
          if (esiste && esiste.data) delete dateUsate[esiste.data];
          dateUsate[campi.data] = op.id;
        }
        if (tipo === 'squadra' && azione !== 'elimina') {
          if (campi.persona_id && !persone[campi.persona_id]) throw new CtrlError('INVALID', 'Persona non trovata nella rubrica' + where);
          if (campi.giornata_id && !appartiene.giornata[campi.giornata_id]) throw new CtrlError('INVALID', 'Giornata non valida' + where);
          if (campi.spazio_id && !appartiene.spazio[campi.spazio_id]) throw new CtrlError('INVALID', 'Spazio non valido' + where);
        }
        // aggiorna lo stato simulato per le operazioni successive del lotto
        if (tipo === 'persona') persone[op.id] = persone[op.id] || { id: op.id };
        else if (azione === 'elimina') delete appartiene[tipo][op.id];
        else appartiene[tipo][op.id] = appartiene[tipo][op.id] || { id: op.id, data: campi.data };
        piano.push({ tipo: tipo, azione: crea ? 'crea' : (azione === 'crea' ? 'modifica' : azione), id: op.id, campi: campi, versione: op.versione, prima: esiste || null });
      });

      // scrittura
      var conflitti = [];
      var riepilogo = {};
      piano.forEach(function (o) {
        var tabella = o.tipo === 'produzione' ? 'progetti' : TABELLE[o.tipo];
        riepilogo[o.tipo + '.' + o.azione] = (riepilogo[o.tipo + '.' + o.azione] || 0) + 1;
        if (o.azione === 'crea') {
          var row = { id: o.id, eliminato: 'FALSE', creato_il: now, aggiornato_il: now, aggiornato_da: user.email, versione: '1' };
          if (o.tipo === 'persona') row.creato_da = user.email; else row.progetto_id = pid;
          if (o.tipo === 'spazio' && !o.campi.tipo) row.tipo = 'altro';
          Object.keys(o.campi).forEach(function (k) { row[k] = o.campi[k]; });
          Db.insert(tabella, row);
          return;
        }
        var attuale = Db.find(tabella, 'id', o.id);
        if (o.versione && String(o.versione) !== String(attuale.versione || '1') && attuale.aggiornato_da !== user.email) {
          conflitti.push({ tipo: o.tipo, id: o.id, da: attuale.aggiornato_da, il: attuale.aggiornato_il });
        }
        if (o.azione === 'elimina') {
          Db.update(tabella, 'id', o.id, { eliminato: 'TRUE', aggiornato_il: now, aggiornato_da: user.email });
          // chi era assegnato a una giornata o uno spazio tolti resta in squadra, senza quell'assegnazione
          if (o.tipo === 'giornata' || o.tipo === 'spazio') {
            var campo = o.tipo === 'giornata' ? 'giornata_id' : 'spazio_id';
            figli('squadra', pid).forEach(function (s) {
              if (s[campo] === o.id) { var patch = {}; patch[campo] = ''; patch.aggiornato_il = now; patch.aggiornato_da = user.email; Db.update('squadra', 'id', s.id, patch); }
            });
          }
          return;
        }
        var patch = {};
        Object.keys(o.campi).forEach(function (k) { patch[k] = o.campi[k]; });
        patch.aggiornato_il = now; patch.aggiornato_da = user.email;
        Db.update(tabella, 'id', o.id, patch);
      });
      if (piano.some(function (o) { return o.tipo === 'giornata'; })) aggiornaDate(pid, user);
      Db.update('progetti', 'id', pid, { aggiornato_il: now, aggiornato_da: user.email }, null, true);
      Storico.log(user.email, '', 'produzione', 'salva', pid, '', JSON.stringify({ modifiche: riepilogo, operazioni: piano.map(function (o) { return [o.tipo, o.azione, o.id]; }) }));
      return vista(user, pid, { conflitti: conflitti, salvato_il: now });
    });
  }

  // ---------- rubrica ----------

  function rubrica(user) {
    void user;
    return Db.all('persone').filter(vivo)
      .map(personaVista)
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'it'); });
  }

  /** Toglie una persona dalla rubrica (solo admin). Le squadre che la usano ricevono un avviso. */
  function eliminaPersona(user, p) {
    Users.require(user, 'admin');
    return Db.withLock(function () {
      var r = trova('persone', p && p.id);
      if (!r) throw new CtrlError('NOT_FOUND', 'Persona non trovata');
      Db.update('persone', 'id', r.id, { eliminato: 'TRUE', aggiornato_il: Util.nowIso(), aggiornato_da: user.email });
      Storico.log(user.email, '', 'persone', 'elimina', r.id, r.nome, '');
      return rubrica(user);
    });
  }

  return {
    TIPI_SPAZIO: TIPI_SPAZIO, get: get, riepilogo: riepilogo, crea: crea, collega: collega, scollega: scollega,
    salva: salva, rubrica: rubrica, eliminaPersona: eliminaPersona
  };
})();
