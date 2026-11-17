/**
 * CTRL · Produzione = contenitore dei documenti operativi (Production Plan e Material List).
 *
 * Una produzione (tabella "progetti") raggruppa uno o più eventi del Calendar (eventi.progetto_id):
 * un concerto ha un evento, un festival ne ha molti che condividono gli stessi documenti.
 * Si crea da sola la prima volta che si apre un documento (assicura).
 */
var Produzioni = (function () {
  function vivo(r) { return r && !Util.bool(r.eliminato); }
  function trova(id) {
    var r = Db.find('progetti', 'id', String(id || ''));
    return vivo(r) ? r : null;
  }
  function evento(id) {
    var e = Db.find('eventi', 'id', String(id || ''));
    if (!e) throw new CtrlError('NOT_FOUND', 'Evento non trovato');
    return e;
  }
  function eventiDi(pid) {
    return Db.all('eventi').filter(function (e) { return e.progetto_id === pid; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });
  }

  function aggiornaDate(pid) {
    var ev = eventiDi(pid);
    var patch = { data: ev.length ? ev[0].data : '', data_fine: ev.reduce(function (m, e) { var f = e.data_fine || e.data; return f > m ? f : m; }, '') };
    var p = trova(pid);
    if (patch.data !== (p.data || '') || patch.data_fine !== (p.data_fine || '')) Db.update('progetti', 'id', pid, patch, null, true);
  }

  /** Riepilogo per il dettaglio evento: eventi della produzione e documenti già scritti. */
  function riepilogo(pid) {
    var p = trova(pid);
    if (!p) return null;
    return {
      id: p.id, nome: p.nome, tipo: p.tipo || 'evento',
      eventi: eventiDi(pid).map(function (e) { return { id: e.id, titolo: e.titolo, data: e.data }; }),
      documenti: Documenti.riepilogo(pid)
    };
  }

  /** Restituisce la produzione di un evento, creandola se manca. */
  function assicura(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var e = evento(p && p.evento_id);
      Staff.richiediEvento(user, e);
      if (trova(e.progetto_id)) return riepilogo(e.progetto_id);
      var now = Util.nowIso(), pid = Util.newId('pr');
      Db.insert('progetti', { id: pid, nome: Util.text(e.titolo, 120) || 'Produzione', tipo: 'evento', stato: 'attivo',
        creato_il: now, creato_da: user.email, aggiornato_il: now, aggiornato_da: user.email, versione: '1', eliminato: 'FALSE', note: '' });
      Db.update('eventi', 'id', e.id, { progetto_id: pid }, null, true);
      aggiornaDate(pid);
      Storico.log(user.email, e.id, 'produzione', 'crea', pid, '', { nome: e.titolo });
      return riepilogo(pid);
    });
  }

  /** Mette un altro evento nella stessa produzione (festival): condivide Plan e Material List. */
  function collega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pr = trova(p && p.id);
      if (!pr) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
      var e = evento(p && p.evento_id);
      Staff.richiediProduzione(user, pr.id);
      Staff.richiediEvento(user, e);
      if (e.progetto_id === pr.id) return riepilogo(pr.id);
      if (trova(e.progetto_id)) throw new CtrlError('INVALID', 'Questo evento fa già parte di un\'altra scheda di produzione');
      Db.update('eventi', 'id', e.id, { progetto_id: pr.id }, null, true);
      Db.update('progetti', 'id', pr.id, { tipo: 'festival', aggiornato_il: Util.nowIso(), aggiornato_da: user.email });
      aggiornaDate(pr.id);
      Storico.log(user.email, e.id, 'produzione', 'collega', pr.id, '', { evento: e.titolo });
      return riepilogo(pr.id);
    });
  }

  function scollega(user, p) {
    Users.require(user, 'modificare');
    return Db.withLock(function () {
      var pr = trova(p && p.id);
      if (!pr) throw new CtrlError('NOT_FOUND', 'Scheda di produzione non trovata');
      var e = evento(p && p.evento_id);
      Staff.richiediProduzione(user, pr.id);
      if (e.progetto_id !== pr.id) throw new CtrlError('NOT_FOUND', 'Evento non collegato a questa scheda');
      if (eventiDi(pr.id).length <= 1) throw new CtrlError('INVALID', 'Una scheda di produzione deve avere almeno un evento');
      Db.update('eventi', 'id', e.id, { progetto_id: '' }, null, true);
      aggiornaDate(pr.id);
      Storico.log(user.email, e.id, 'produzione', 'scollega', pr.id, { evento: e.titolo }, '');
      return riepilogo(pr.id);
    });
  }

  return { riepilogo: riepilogo, assicura: assicura, collega: collega, scollega: scollega };
})();
