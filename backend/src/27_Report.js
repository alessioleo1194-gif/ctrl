/**
 * CTRL · Staff Work Report (solo Owner).
 *
 * Nessun archivio a parte: il report si legge dai turni (`turni`), una riga per tecnico e per giornata, quindi si
 * aggiorna da solo con assegnazioni, giornate e orari. Orari sempre PIANIFICATI (quelli effettivi si aggiungeranno dopo).
 * Gli eventi annullati restano nel report, segnalati, ma non entrano nei totali. Le giornate che finiscono dopo la
 * mezzanotte appartengono alla data di inizio e durano fino all'orario del giorno dopo.
 */
var Report = (function () {
  var GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

  function nomeCognome_(u, email) {
    var completo = u ? Staff.nomeDi(u) : String(email).split('@')[0];
    var p = String(completo).trim().split(/\s+/);
    return { nome: p[0] || '', cognome: p.slice(1).join(' '), completo: completo };
  }

  function giornoSettimana_(data) { return GIORNI[(Util.dayNum(data) + 4) % 7]; }

  function minutiDi_(x) { return x.iv ? x.iv.e - x.iv.s : null; }

  function ore_(min) { return Math.round(min / 60 * 100) / 100; }

  function tutteLeRighe_() {
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var posizione = {};
    var perEv = {};
    Db.all('giorni').forEach(function (g) { if (!Util.bool(g.eliminato)) (perEv[g.evento_id] = perEv[g.evento_id] || []).push(g); });
    Object.keys(perEv).forEach(function (id) {
      perEv[id].sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; })
        .forEach(function (g, i, l) { posizione[g.id] = { n: i + 1, di: l.length }; });
    });
    return Turni.carica_().map(function (x) {
      var nc = nomeCognome_(utenti[x.email], x.email);
      var pos = posizione[x.g.id] || { n: 1, di: 1 };
      var min = minutiDi_(x);
      return {
        id: x.t.id, data: x.data, giorno: giornoSettimana_(x.data), email: x.email, nome: nc.nome, cognome: nc.cognome, tecnico: nc.completo,
        evento_id: x.e.id, evento: x.e.titolo, location: x.e.luogo || '', ora_inizio: x.ora_inizio, ora_fine: x.ora_fine,
        durata_min: min, durata_ore: min === null ? null : ore_(min), dopo_mezzanotte: Giorni.dopoMezzanotte(x.ora_inizio, x.ora_fine),
        nota: x.t.nota || x.g.nota || '', annullato: x.e.stato === 'annullato', stato_evento: x.e.stato, n: pos.n, di: pos.di,
        _iv: x.iv
      };
    });
  }

  function pulisci_(r) { var o = {}; Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = r[k]; }); return o; }

  /** Righe del report con filtri (anno, mese, da/a, tecnico, evento) e riepiloghi. */
  function righe(user, p) {
    Users.require(user, 'impostazioni');
    p = p || {};
    var tutte = tutteLeRighe_();
    var anno = p.anno ? String(p.anno) : '';
    var mese = p.mese ? String(p.mese).padStart(2, '0') : '';
    if (mese && !anno) anno = Util.today().slice(0, 4);
    if (anno && !/^\d{4}$/.test(anno)) throw new CtrlError('INVALID', 'Anno non valido');
    if (mese && !/^(0[1-9]|1[0-2])$/.test(mese)) throw new CtrlError('INVALID', 'Mese non valido');
    if (p.da && !Util.isDate(p.da)) throw new CtrlError('INVALID', 'Data non valida');
    if (p.a && !Util.isDate(p.a)) throw new CtrlError('INVALID', 'Data non valida');
    var email = p.email ? Util.normEmail(p.email) : '';
    var conAnnullati = p.annullati !== false;

    var filtrate = tutte.filter(function (r) {
      if (anno && r.data.slice(0, 4) !== anno) return false;
      if (mese && r.data.slice(5, 7) !== mese) return false;
      if (p.da && r.data < p.da) return false;
      if (p.a && r.data > p.a) return false;
      if (email && r.email !== email) return false;
      if (p.evento_id && r.evento_id !== String(p.evento_id)) return false;
      if (!conAnnullati && r.annullato) return false;
      return true;
    }).sort(function (a, b) {
      var ka = a.data + (a.ora_inizio || '99:99') + a.tecnico.toLowerCase(), kb = b.data + (b.ora_inizio || '99:99') + b.tecnico.toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    var conta = filtrate.filter(function (r) { return !r.annullato; });
    var minTot = 0, senza = 0;
    var perTec = {};
    conta.forEach(function (r) {
      var t = perTec[r.email] = perTec[r.email] || { email: r.email, nome: r.tecnico, giornate: 0, minuti: 0 };
      t.giornate++;
      if (r.durata_min === null) senza++; else { t.minuti += r.durata_min; minTot += r.durata_min; }
    });
    var anni = {}, tecnici = {}, eventi = {};
    tutte.forEach(function (r) {
      anni[r.data.slice(0, 4)] = true;
      tecnici[r.email] = r.tecnico;
      eventi[r.evento_id] = r.evento;
    });
    return {
      righe: filtrate.map(pulisci_),
      totali: { giornate: conta.length, minuti: minTot, ore: ore_(minTot), senza_orario: senza, annullate: filtrate.length - conta.length },
      per_tecnico: Object.keys(perTec).map(function (k) { var t = perTec[k]; t.ore = ore_(t.minuti); return t; })
        .sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1; }),
      filtri: {
        anni: Object.keys(anni).sort(),
        tecnici: Object.keys(tecnici).map(function (e) { return { email: e, nome: tecnici[e] }; }).sort(function (a, b) { return a.nome.toLowerCase() < b.nome.toLowerCase() ? -1 : 1; }),
        eventi: Object.keys(eventi).map(function (i) { return { id: i, titolo: eventi[i] }; }).sort(function (a, b) { return a.titolo.toLowerCase() < b.titolo.toLowerCase() ? -1 : 1; })
      },
      periodo: { anno: anno, mese: mese, da: p.da || '', a: p.a || '' }
    };
  }

  /**
   * Numeri del popup sui nomi: mese corrente, un conteggio per persona.
   * Giornate lavorate = turni già conclusi (fine passata; senza orari: da domani); future = ancora da svolgere (oggi
   * incluso finché non finisce); ore lavorate = ore pianificate dei turni conclusi. Eventi annullati esclusi.
   * `adesso` ("yyyy-MM-ddTHH:mm") serve solo ai test.
   */
  function statistiche(user, p) {
    Users.require(user, 'impostazioni');
    var adesso = p && p.adesso ? String(p.adesso) : '';
    var oggi, ora;
    if (adesso) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(adesso)) throw new CtrlError('INVALID', 'Momento non valido');
      oggi = adesso.slice(0, 10); ora = adesso.slice(11, 16);
    } else { oggi = Util.today(); ora = Util.fmtTime(new Date()); }
    var adessoAbs = Util.dayNum(oggi) * 1440 + Util.minuti(ora);
    var mese = oggi.slice(0, 7);
    var utenti = {};
    Db.all('utenti').forEach(function (u) { utenti[Util.normEmail(u.email)] = u; });
    var per = {};
    tutteLeRighe_().forEach(function (r) {
      if (r.annullato || r.data.slice(0, 7) !== mese) return;
      var s = per[r.email] = per[r.email] || { email: r.email, id: (utenti[r.email] || {}).id || '', giornate_lavorate: 0, giornate_future: 0, minuti: 0 };
      var finita = r._iv ? r._iv.e <= adessoAbs : r.data < oggi;
      if (finita) { s.giornate_lavorate++; if (r.durata_min !== null) s.minuti += r.durata_min; }
      else s.giornate_future++;
    });
    return {
      mese: mese, aggiornato: oggi + 'T' + ora,
      persone: Object.keys(per).map(function (k) {
        var s = per[k];
        return { email: s.email, id: s.id, giornate_lavorate: s.giornate_lavorate, giornate_future: s.giornate_future, ore_lavorate: ore_(s.minuti) };
      })
    };
  }

  return { righe: righe, statistiche: statistiche };
})();
