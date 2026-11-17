/**
 * Tappa 2: programma della produzione (Production Schedule).
 * Backend vero con i servizi Google simulati, più le regole condivise con l'app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';
import ProgrammaApp from '../../app/js/programma.js';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';

function isoDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
}

const CAL = [
  { id: 'a@google.com', title: 'Bill Frisell Trio', start: isoDay(3) + 'T19:00:00Z', end: isoDay(3) + 'T22:00:00Z', location: 'Teatro Cavallino Bianco, Galatina' },
  { id: 'b@google.com', title: 'Altro concerto', start: isoDay(5) + 'T19:00:00Z', end: isoDay(5) + 'T22:00:00Z', location: 'Lecce' }
];

let seq = 0;
const nid = (p) => `${p}_${String(++seq).padStart(4, '0')}abcd${Math.random().toString(36).slice(2, 8)}`;
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
/** Righe del foglio come oggetti (la prima riga è l'intestazione). */
const rows = (env, name) => {
  const [head, ...data] = env.getSS(DB).getSheetByName(name).rows();
  return data.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
};

function boot() {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: CAL });
  env.ctx.setupProduzione();
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email: ADMIN });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  env.token = call(env.ctx, 'auth.verifyCode', { email: ADMIN, code }).data.token;
  const list = ok(call(env.ctx, 'eventi.list', {}, env.token));
  env.ev = (t) => list.find(e => e.titolo.startsWith(t));
  env.salva = (pid, ops) => call(env.ctx, 'produzione.salva', { id: pid, ops }, env.token);
  return env;
}

function scheda(env, titolo = 'Bill') {
  return ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev(titolo).id }, env.token));
}

const att = (id, gid, campi) => ({ tipo: 'attivita', azione: 'crea', id, campi: { giornata_id: gid, ...campi } });

test('le regole del programma nell\'app sono identiche a quelle del server', () => {
  const env = boot();
  const S = env.ctx.Programma;
  const j = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(j(S.ATTIVITA), ProgrammaApp.ATTIVITA);
  assert.equal(S.ATTIVITA.length, 22);
  for (const o of ['00:00', '05:59', '06:00', '23:59', '24:00', '9:00', '12:60', '', null, '16:30']) {
    assert.equal(S.minuti(o), ProgrammaApp.minuti(o), 'minuti ' + o);
    assert.equal(S.isOra(o), ProgrammaApp.isOra(o), 'isOra ' + o);
  }
  const g = [{ id: 'g1', data: '2026-11-08' }];
  const lista = [
    { id: 'x1', giornata_id: 'g1', tipo: 'Soundcheck', ora_inizio: '16:45', ora_fine: '18:30', spazio_id: 's1', responsabile: 'Bill Frisell Trio', ordine: '1' },
    { id: 'x2', giornata_id: 'g1', tipo: 'Load-in', ora_inizio: '18:00', ora_fine: '18:45', spazio_id: 's1', responsabile: 'Yugen Trio', ordine: '2' },
    { id: 'x3', giornata_id: 'g1', tipo: 'Dinner', ora_inizio: '19:00', ora_fine: '20:00', spazio_id: '', responsabile: ' bill frisell  trio ', ordine: '3' },
    { id: 'x4', giornata_id: 'g1', tipo: 'Load-out', ora_inizio: '00:30', ora_fine: '02:00', spazio_id: 's1', responsabile: '', ordine: '4' },
    { id: 'x5', giornata_id: 'g1', tipo: 'Strike', ora_inizio: '23:30', ora_fine: '01:00', spazio_id: 's1', responsabile: '', ordine: '5' },
    { id: 'x6', giornata_id: 'g1', tipo: '', ora_inizio: '', ora_fine: '', spazio_id: '', responsabile: '', ordine: '6' },
    { id: 'x7', giornata_id: 'g1', tipo: 'Custom', attivita: 'Press', ora_inizio: '10:00', ora_fine: '09:00', spazio_id: '', responsabile: '', ordine: '7' },
    { id: 'x8', giornata_id: 'g1', tipo: 'Doors Open', ora_inizio: '18:00', ora_fine: '', spazio_id: 's1', responsabile: '', ordine: '0' }
  ];
  assert.deepEqual(j(S.ordina(lista)).map(a => a.id), ProgrammaApp.ordina(lista).map(a => a.id));
  assert.deepEqual(j(S.sovrapposizioni(lista)), ProgrammaApp.sovrapposizioni(lista));
  assert.deepEqual(j(S.avvisi(g, lista)), ProgrammaApp.avvisi(g, lista));
});

test('ordine cronologico della giornata operativa e sovrapposizioni', () => {
  const P = ProgrammaApp;
  const lista = [
    { id: 'out', tipo: 'Load-out', ora_inizio: '00:30', ora_fine: '02:00', spazio_id: 's1' },
    { id: 'in', tipo: 'Load-in', ora_inizio: '08:00', spazio_id: 's1' },
    { id: 'b', tipo: 'Soundcheck', ora_inizio: '16:45', ora_fine: '18:30', spazio_id: 's1', ordine: '2' },
    { id: 'a', tipo: 'Backline Setup', ora_inizio: '16:45', spazio_id: 's1', ordine: '1' },
    { id: 'senza', tipo: 'Meeting' },
    { id: 'strike', tipo: 'Strike', ora_inizio: '23:30', ora_fine: '01:00', spazio_id: 's1' }
  ];
  // 00:30 va dopo 23:30; a parità di orario conta "ordine"; senza orario in fondo
  assert.deepEqual(P.ordina(lista).map(a => a.id), ['in', 'a', 'b', 'strike', 'out', 'senza']);
  // strike 23:30–01:00 e load-out 00:30–02:00 nello stesso spazio si sovrappongono
  assert.deepEqual(P.sovrapposizioni(lista), [{ a: 'strike', b: 'out', motivo: 'spazio' }]);
  // stesso orario in spazi diversi e responsabili diversi: nessun avviso
  assert.deepEqual(P.sovrapposizioni([
    { id: 'x', ora_inizio: '19:00', ora_fine: '20:00', spazio_id: 's1', responsabile: 'Band A' },
    { id: 'y', ora_inizio: '19:00', ora_fine: '20:00', spazio_id: 's2', responsabile: 'Band B' }
  ]), []);
  // attività che si toccano senza accavallarsi: nessun avviso
  assert.deepEqual(P.sovrapposizioni([
    { id: 'x', ora_inizio: '19:00', ora_fine: '20:00', spazio_id: 's1' },
    { id: 'y', ora_inizio: '20:00', ora_fine: '21:00', spazio_id: 's1' }
  ]), []);
  assert.equal(P.nome({ tipo: 'Custom', attivita: 'Press conference' }), 'Press conference');
});

test('attività: crea, modifica, ordine, giornata e note della giornata; un crea ripetuto non duplica', () => {
  const env = boot();
  const p = scheda(env);
  const g = p.giornate[0].id, s = p.spazi[0].id;
  assert.equal(p.blocchi.programma.stato, 'vuoto');
  assert.equal(p.catalogo_attivita.length, 22);
  const a1 = nid('att'), a2 = nid('att');
  const ops = [
    att(a1, g, { tipo: 'Soundcheck', ora_inizio: '16:45', ora_fine: '18:30', spazio_id: s, responsabile: 'Bill Frisell Trio', note: 'Line check prima' }),
    att(a2, g, { tipo: 'Custom', attivita: 'Cena presso Anima e Cuore', ora_inizio: '19:00' }),
    { tipo: 'giornata', azione: 'modifica', id: g, campi: { note: 'Accesso carico da via Roma' } }
  ];
  let r = ok(env.salva(p.id, ops));
  assert.deepEqual(r.attivita.map(a => [a.tipo, a.attivita, a.ora_inizio, a.ora_fine, a.spazio_id, a.responsabile]), [
    ['Soundcheck', '', '16:45', '18:30', s, 'Bill Frisell Trio'],
    ['Custom', 'Cena presso Anima e Cuore', '19:00', '', '', '']
  ]);
  assert.equal(r.giornate[0].note, 'Accesso carico da via Roma');
  assert.equal(r.blocchi.programma.stato, 'completo');
  assert.deepEqual([r.blocchi.programma.attivita, r.blocchi.programma.giornate], [2, 1]);
  // lo stesso lotto inviato di nuovo (rete caduta dopo il salvataggio): nessun doppione
  r = ok(env.salva(p.id, ops));
  assert.equal(r.attivita.length, 2);
  assert.equal(rows(env, 'attivita').length, 2);
  // spostare l'orario cambia l'ordine
  r = ok(env.salva(p.id, [{ tipo: 'attivita', azione: 'modifica', id: a2, campi: { ora_inizio: '08:00' } }]));
  assert.deepEqual(r.attivita.map(a => a.id), [a2, a1]);
  // nel foglio la riga ha progetto e giornata
  const riga = rows(env, 'attivita').find(x => x.id === a1);
  assert.equal(riga.progetto_id, p.id);
  assert.equal(riga.giornata_id, g);
});

test('attività non valide: orario, tipo, giornata o spazio di un\'altra scheda; il lotto non scrive nulla', () => {
  const env = boot();
  const p = scheda(env), altra = scheda(env, 'Altro');
  const g = p.giornate[0].id;
  const casi = [
    [att(nid('att'), g, { ora_inizio: '25:00' }), /Orario non valido/],
    [att(nid('att'), g, { ora_fine: '9.30' }), /Orario non valido/],
    [att(nid('att'), g, { tipo: 'Party' }), /Attività non valida/],
    [att(nid('att'), altra.giornate[0].id, {}), /Giornata non valida/],
    [att(nid('att'), g, { spazio_id: altra.spazi[0].id }), /Spazio non valido/],
    [{ tipo: 'attivita', azione: 'crea', id: nid('att'), campi: { tipo: 'Setup' } }, /appartenere a una giornata/],
    [att('att_x', g, {}), /Identificativo non valido/],
    [att(nid('att'), g, { colore: 'rosso' }), /Campo non valido/]
  ];
  for (const [op, re] of casi) {
    const valida = att(nid('att'), g, { tipo: 'Setup', ora_inizio: '10:00' });
    const res = env.salva(p.id, [valida, op]);
    assert.equal(res.ok, false, JSON.stringify(op));
    assert.match(res.error.message, re);
  }
  assert.equal(rows(env, 'attivita').length, 0);
});

test('giornata tolta: le sue attività spariscono; spazio tolto: le attività restano senza spazio', () => {
  const env = boot();
  const p = scheda(env);
  const g1 = p.giornate[0].id, s = p.spazi[0].id;
  const g2 = nid('gio');
  const a1 = nid('att'), a2 = nid('att');
  ok(env.salva(p.id, [
    { tipo: 'giornata', azione: 'crea', id: g2, campi: { data: isoDay(4) } },
    att(a1, g1, { tipo: 'Soundcheck', ora_inizio: '17:00', spazio_id: s }),
    att(a2, g2, { tipo: 'Load-out', ora_inizio: '10:00', spazio_id: s })
  ]));
  let r = ok(env.salva(p.id, [{ tipo: 'spazio', azione: 'elimina', id: s }]));
  assert.deepEqual(r.attivita.map(a => a.spazio_id), ['', '']);
  r = ok(env.salva(p.id, [{ tipo: 'giornata', azione: 'elimina', id: g2 }]));
  assert.deepEqual(r.attivita.map(a => a.id), [a1]);
  assert.equal(rows(env, 'attivita').find(x => x.id === a2).eliminato, 'TRUE');
  // un'attività tolta non si può più modificare
  const res = env.salva(p.id, [{ tipo: 'attivita', azione: 'modifica', id: a2, campi: { note: 'x' } }]);
  assert.equal(res.ok, false);
});

test('avvisi del programma: sovrapposizioni, orari mancanti, durate sospette; contano nella scheda e nel riepilogo', () => {
  const env = boot();
  const p = scheda(env);
  const g = p.giornate[0].id, s = p.spazi[0].id;
  const r = ok(env.salva(p.id, [
    att(nid('att'), g, { tipo: 'Soundcheck', ora_inizio: '16:45', ora_fine: '18:30', spazio_id: s }),
    att(nid('att'), g, { tipo: 'Load-in', ora_inizio: '18:00', ora_fine: '18:45', spazio_id: s }),
    att(nid('att'), g, { tipo: 'Meeting' }),
    att(nid('att'), g, { tipo: 'Setup', ora_inizio: '10:00', ora_fine: '09:00' })
  ]));
  const testi = r.avvisi.filter(a => a.blocco === 'programma').map(a => a.testo);
  assert.equal(testi.length, 3, testi.join('\n'));
  assert.ok(testi.some(t => /Soundcheck 16:45 e Load-in 18:00 si sovrappongono \(stesso spazio\)/.test(t)));
  assert.ok(testi.some(t => /Meeting senza orario/.test(t)));
  assert.ok(testi.some(t => /Setup 10:00 dura più di 12 ore/.test(t)));
  assert.equal(r.blocchi.programma.stato, 'in_corso');
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev('Bill').id }, env.token));
  assert.equal(ev.produzione.blocchi.programma.attivita, 4);
});

test('la sola lettura vede il programma ma non lo modifica', () => {
  const env = boot();
  const p = scheda(env);
  ok(env.salva(p.id, [att(nid('att'), p.giornate[0].id, { tipo: 'Doors Open', ora_inizio: '19:30' })]));
  ok(call(env.ctx, 'utenti.save', { email: 'lettura@example.com', nome: 'L', ruolo: 'LETTURA' }, env.token));
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email: 'lettura@example.com' });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  const t = call(env.ctx, 'auth.verifyCode', { email: 'lettura@example.com', code }).data.token;
  const vista = ok(call(env.ctx, 'produzione.get', { id: p.id }, t));
  assert.equal(vista.attivita.length, 1);
  assert.equal(vista.permessi.modificare, false);
  const res = call(env.ctx, 'produzione.salva', { id: p.id, ops: [att(nid('att'), p.giornate[0].id, { tipo: 'Setup' })] }, t);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'FORBIDDEN');
});

test('orari scritti in fretta vengono riconosciuti', async () => {
  const { normalizzaOra, sommaMinuti } = await import('../../app/js/orari.js');
  const casi = { '1630': '16:30', '16.30': '16:30', '16,30': '16:30', '9': '09:00', '930': '09:30', '16:3': '16:30',
    '0': '00:00', '24': '00:00', '2400': '00:00', '23:59': '23:59', '': '', '  ': '', '2460': null, '25': null, 'ab': null, '12345': null, '7:5': '07:50' };
  for (const [k, v] of Object.entries(casi)) assert.equal(normalizzaOra(k), v, k);
  assert.equal(sommaMinuti('23:30', 90), '01:00');
  assert.equal(sommaMinuti('16:45', 105), '18:30');
});
