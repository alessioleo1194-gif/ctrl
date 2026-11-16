/**
 * Tappa 1: scheda di produzione (produzioni, giornate, spazi, rubrica, squadra).
 * Backend vero con i servizi Google simulati.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';

function isoDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
}

const CAL = [
  { id: 'a@google.com', title: 'Cantelmo: Malamore + Lumiero', start: isoDay(3) + 'T17:00:00Z', end: isoDay(3) + 'T22:00:00Z', location: 'Officine Cantelmo, Lecce' },
  { id: 'b@google.com', title: 'Festival · giorno 1', allDay: true, start: isoDay(10), end: isoDay(12), location: 'Castello Carlo V, Lecce' },
  { id: 'c@google.com', title: 'Festival · giorno 3', allDay: true, start: isoDay(12), end: isoDay(13) }
];

let seq = 0;
const nid = (p) => `${p}_${String(++seq).padStart(4, '0')}abcd${Math.random().toString(36).slice(2, 8)}`;

function boot() {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: CAL });
  env.ctx.setupProduzione();
  env.token = login(env);
  const list = ok(call(env.ctx, 'eventi.list', {}, env.token));
  env.ev = (t) => list.find(e => e.titolo.startsWith(t));
  return env;
}

function login(env, email = ADMIN) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return call(env.ctx, 'auth.verifyCode', { email, code }).data.token;
}

function utente(env, email, ruolo, extra = {}) {
  ok(call(env.ctx, 'utenti.save', { email, nome: email, ruolo, ...extra }, env.token));
  return login(env, email);
}

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const rows = (env, name) => env.getSS(DB).getSheetByName(name).rows();
const salva = (env, pid, ops, token = env.token) => call(env.ctx, 'produzione.salva', { id: pid, ops }, token);

test('crea la scheda da un evento: giornata dalla data, spazio dal luogo; una seconda richiesta non duplica', () => {
  const env = boot();
  const ev = env.ev('Cantelmo');
  const p = ok(call(env.ctx, 'produzione.crea', { evento_id: ev.id }, env.token));
  assert.equal(p.nome, 'Cantelmo: Malamore + Lumiero');
  assert.equal(p.tipo, 'evento');
  assert.deepEqual(p.eventi.map(e => e.id), [ev.id]);
  assert.deepEqual(p.giornate.map(g => g.data), [isoDay(3)]);
  assert.deepEqual(p.spazi.map(s => [s.nome, s.indirizzo, s.tipo]), [['Officine Cantelmo', 'Officine Cantelmo, Lecce', 'venue']]);
  assert.deepEqual(p.blocchi.struttura, { stato: 'completo', giornate: 1, spazi: 1 });
  assert.equal(p.blocchi.persone.stato, 'vuoto');
  assert.ok(p.avvisi.some(a => a.testo === 'Squadra vuota'));
  const again = ok(call(env.ctx, 'produzione.crea', { evento_id: ev.id }, env.token));
  assert.equal(again.id, p.id);
  assert.equal(rows(env, 'progetti').length, 2, 'una sola produzione nel foglio');
  // il dettaglio evento la riporta
  const det = ok(call(env.ctx, 'eventi.get', { id: ev.id }, env.token));
  assert.equal(det.produzione.id, p.id);
  assert.equal(det.produzione_id, p.id);
});

test('festival: un evento di più giorni e un secondo evento nella stessa scheda; date senza giornata segnalate', () => {
  const env = boot();
  const g1 = env.ev('Festival · giorno 1'), g3 = env.ev('Festival · giorno 3');
  let p = ok(call(env.ctx, 'produzione.crea', { evento_id: g1.id }, env.token));
  assert.deepEqual(p.giornate.map(g => g.data), [isoDay(10), isoDay(11)]);
  p = ok(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: g3.id }, env.token));
  assert.equal(p.tipo, 'festival');
  assert.deepEqual(p.giornate.map(g => g.data), [isoDay(10), isoDay(11), isoDay(12)]);
  assert.equal(p.eventi.length, 2);
  // tolgo una giornata: l'evento ha una data scoperta
  const g12 = p.giornate.find(g => g.data === isoDay(12));
  p = ok(salva(env, p.id, [{ tipo: 'giornata', azione: 'elimina', id: g12.id }]));
  assert.ok(p.avvisi.some(a => a.testo.includes('Festival · giorno 3') && a.testo.includes(isoDay(12))));
  assert.equal(p.blocchi.struttura.stato, 'in_corso');
  // l'evento di un'altra scheda non si può collegare
  const altra = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  assert.equal(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: env.ev('Cantelmo').id }, env.token).error.code, 'INVALID');
  // scollega sì, ma non l'ultimo evento
  p = ok(call(env.ctx, 'produzione.scollega', { id: p.id, evento_id: g3.id }, env.token));
  assert.equal(p.eventi.length, 1);
  assert.equal(call(env.ctx, 'produzione.scollega', { id: p.id, evento_id: g1.id }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'produzione.scollega', { id: altra.id, evento_id: g1.id }, env.token).error.code, 'NOT_FOUND');
});

test('salvataggio a lotti: crea, modifica, elimina spazi, giornate, persone e squadra in una volta', () => {
  const env = boot();
  let p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const palco = nid('spa'), giorno = nid('gio'), manuel = nid('per'), sq = nid('sq');
  p = ok(salva(env, p.id, [
    { tipo: 'produzione', azione: 'modifica', campi: { nome: 'Malamore · Cantelmo', note: 'Ingresso carico da via Libertini' } },
    { tipo: 'spazio', azione: 'crea', id: palco, campi: { nome: 'Palco principale', tipo: 'palco', ordine: '2' } },
    { tipo: 'giornata', azione: 'crea', id: giorno, campi: { data: isoDay(2), etichetta: 'Montaggio' } },
    { tipo: 'persona', azione: 'crea', id: manuel, campi: { nome: 'Manuel', ruolo: 'Fonico', telefono: '+39 333 000 0000', email: 'manuel@example.com' } },
    { tipo: 'squadra', azione: 'crea', id: sq, campi: { persona_id: manuel, ruolo: 'Fonico di sala', spazio_id: palco, giornata_id: giorno } }
  ]));
  assert.equal(p.nome, 'Malamore · Cantelmo');
  assert.equal(p.note, 'Ingresso carico da via Libertini');
  assert.deepEqual(p.spazi.map(s => s.nome), ['Officine Cantelmo', 'Palco principale']);
  assert.deepEqual(p.giornate.map(g => [g.data, g.etichetta]), [[isoDay(2), 'Montaggio'], [isoDay(3), '']]);
  assert.equal(p.squadra.length, 1);
  assert.deepEqual([p.squadra[0].persona.nome, p.squadra[0].ruolo, p.squadra[0].spazio_id], ['Manuel', 'Fonico di sala', palco]);
  assert.equal(p.blocchi.persone.stato, 'completo');
  assert.deepEqual(p.conflitti, []);
  const pr = rows(env, 'progetti').find(r => r[0] === p.id);
  assert.equal(pr[3], isoDay(2), 'data della produzione = prima giornata');

  // elimino lo spazio: la persona resta in squadra senza spazio
  p = ok(salva(env, p.id, [{ tipo: 'spazio', azione: 'elimina', id: palco }]));
  assert.deepEqual(p.spazi.map(s => s.nome), ['Officine Cantelmo']);
  assert.equal(p.squadra[0].spazio_id, '');
  // nel foglio resta come eliminato
  assert.equal(rows(env, 'location').find(r => r[0] === palco)[8], 'TRUE');
  // la persona è nella rubrica comune
  assert.deepEqual(ok(call(env.ctx, 'persone.list', {}, env.token)).map(x => x.nome), ['Manuel']);
});

test('un lotto ripetuto dopo un errore di rete non crea doppioni', () => {
  const env = boot();
  const p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const ops = [{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: 'Camerino' } }];
  ok(salva(env, p.id, ops));
  const again = ok(salva(env, p.id, ops));
  assert.equal(again.spazi.filter(s => s.nome === 'Camerino').length, 1);
  assert.equal(rows(env, 'location').filter(r => r[2] === 'Camerino').length, 1);
});

test('lotto non valido: non scrive nulla, e il messaggio dice quale modifica', () => {
  const env = boot();
  const p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const prima = rows(env, 'location').length;
  const casi = [
    [[{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: 'Ok' } }, { tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: '' } }], /nome/],
    [[{ tipo: 'giornata', azione: 'crea', id: nid('gio'), campi: { data: '2026-02-30' } }], /Data della giornata/],
    [[{ tipo: 'giornata', azione: 'crea', id: nid('gio'), campi: { data: '2026-02-28x' } }], /Valore non valido/],
    [[{ tipo: 'giornata', azione: 'crea', id: nid('gio'), campi: { data: isoDay(3) } }], /già una giornata/],
    [[{ tipo: 'spazio', azione: 'crea', id: 'spa_X!', campi: { nome: 'A' } }], /Identificativo/],
    [[{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: 'A', tipo: 'cucina' } }], /Tipo di spazio/],
    [[{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: 'A', colore: 'rosso' } }], /Campo non valido/],
    [[{ tipo: 'persona', azione: 'crea', id: nid('per'), campi: { nome: 'Luca', email: 'non-email' } }], /Email non valida/],
    [[{ tipo: 'squadra', azione: 'crea', id: nid('sq'), campi: { persona_id: nid('per') } }], /Persona non trovata/],
    [[{ tipo: 'squadra', azione: 'crea', id: nid('sq'), campi: {} }], /Scegli una persona/],
    [[{ tipo: 'spazio', azione: 'modifica', id: nid('spa'), campi: { nome: 'X' } }], /non trovato/],
    [[{ tipo: 'persona', azione: 'elimina', id: nid('per') }], /impostazioni/],
    [[{ tipo: 'evento', azione: 'crea', id: 'x' }], /Tipo non valido/],
    [[], /Nessuna modifica/]
  ];
  for (const [ops, re] of casi) {
    const r = salva(env, p.id, ops);
    assert.equal(r.ok, false, JSON.stringify(ops));
    assert.match(r.error.message, re);
  }
  assert.match(salva(env, p.id, [{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: '' } }]).error.message, /\(modifica|nome/);
  assert.equal(rows(env, 'location').length, prima, 'nessuna riga scritta dai lotti non validi');
  assert.equal(salva(env, 'pr_inesistente0', [{ tipo: 'produzione', azione: 'modifica', campi: { nome: 'x' } }]).error.code, 'NOT_FOUND');
});

test('squadra: giornata o spazio di un\'altra scheda rifiutati; persona creata nello stesso lotto accettata', () => {
  const env = boot();
  const a = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const b = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Festival · giorno 1').id }, env.token));
  const per = nid('per');
  const r = salva(env, a.id, [
    { tipo: 'persona', azione: 'crea', id: per, campi: { nome: 'Federico' } },
    { tipo: 'squadra', azione: 'crea', id: nid('sq'), campi: { persona_id: per, spazio_id: b.spazi[0].id } }
  ]);
  assert.match(r.error.message, /Spazio non valido/);
  assert.equal(ok(call(env.ctx, 'persone.list', {}, env.token)).length, 0, 'il lotto non è stato scritto per niente');
  const p = ok(salva(env, a.id, [
    { tipo: 'persona', azione: 'crea', id: per, campi: { nome: 'Federico' } },
    { tipo: 'squadra', azione: 'crea', id: nid('sq'), campi: { persona_id: per, spazio_id: a.spazi[0].id } }
  ]));
  assert.equal(p.squadra[0].persona.nome, 'Federico');
  assert.ok(p.avvisi.some(x => x.testo === 'Federico: manca il telefono'));
  assert.equal(p.blocchi.persone.stato, 'in_corso');
});

test('modifica concorrente: vince l\'ultimo salvataggio, ma la risposta segnala chi aveva modificato', () => {
  const env = boot();
  const t2 = utente(env, 'cesare@example.com', 'COLLABORATORE', { puo_modificare: true });
  let p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const s = p.spazi[0];
  ok(salva(env, p.id, [{ tipo: 'spazio', azione: 'modifica', id: s.id, versione: s.versione, campi: { note: 'nota di Cesare' } }], t2));
  p = ok(salva(env, p.id, [{ tipo: 'spazio', azione: 'modifica', id: s.id, versione: s.versione, campi: { nome: 'Sala grande' } }]));
  assert.deepEqual(p.conflitti.map(c => [c.id, c.da]), [[s.id, 'cesare@example.com']]);
  assert.equal(p.spazi[0].nome, 'Sala grande');
  assert.equal(p.spazi[0].note, 'nota di Cesare', 'i campi diversi non si perdono');
});

test('permessi: la lettura vede ma non crea né salva; il collaboratore che modifica aggiunge persone; solo l\'admin le toglie', () => {
  const env = boot();
  const lett = utente(env, 'tecnico@example.com', 'LETTURA');
  const coll = utente(env, 'collab@example.com', 'COLLABORATORE', { puo_modificare: true });
  const noMod = utente(env, 'carica@example.com', 'COLLABORATORE', { puo_caricare: true });
  const ev = env.ev('Cantelmo');
  assert.equal(call(env.ctx, 'produzione.crea', { evento_id: ev.id }, lett).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'produzione.crea', { evento_id: ev.id }, noMod).error.code, 'FORBIDDEN');
  const p = ok(call(env.ctx, 'produzione.crea', { evento_id: ev.id }, coll));
  const vista = ok(call(env.ctx, 'produzione.get', { id: p.id }, lett));
  assert.equal(vista.permessi.modificare, false);
  const per = nid('per');
  assert.equal(salva(env, p.id, [{ tipo: 'persona', azione: 'crea', id: per, campi: { nome: 'Gabriele' } }], lett).error.code, 'FORBIDDEN');
  ok(salva(env, p.id, [{ tipo: 'persona', azione: 'crea', id: per, campi: { nome: 'Gabriele' } }], coll));
  assert.equal(call(env.ctx, 'persone.elimina', { id: per }, coll).error.code, 'FORBIDDEN');
  assert.deepEqual(ok(call(env.ctx, 'persone.elimina', { id: per }, env.token)), []);
  assert.equal(call(env.ctx, 'persone.elimina', { id: per }, env.token).error.code, 'NOT_FOUND');
});

test('persona tolta dalla rubrica: resta visibile nella squadra con un avviso', () => {
  const env = boot();
  let p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  const per = nid('per');
  ok(salva(env, p.id, [
    { tipo: 'persona', azione: 'crea', id: per, campi: { nome: 'Nico', telefono: '333' } },
    { tipo: 'squadra', azione: 'crea', id: nid('sq'), campi: { persona_id: per } }
  ]));
  ok(call(env.ctx, 'persone.elimina', { id: per }, env.token));
  p = ok(call(env.ctx, 'produzione.get', { id: p.id }, env.token));
  assert.equal(p.squadra[0].persona.nome, 'Nico');
  assert.equal(p.squadra[0].persona.eliminata, true);
  assert.ok(p.avvisi.some(a => a.testo === 'Nico è stato tolto dalla rubrica'));
});

test('lo storico registra ogni salvataggio con le operazioni', () => {
  const env = boot();
  const p = ok(call(env.ctx, 'produzione.crea', { evento_id: env.ev('Cantelmo').id }, env.token));
  ok(salva(env, p.id, [{ tipo: 'spazio', azione: 'crea', id: nid('spa'), campi: { nome: 'Foyer' } }]));
  const log = rows(env, 'storico').filter(r => r[3] === 'produzione');
  assert.deepEqual(log.map(r => r[4]), ['crea', 'salva']);
  assert.match(log[1][7], /spazio\.crea/);
});
