/**
 * 0.12.0 · Staff Work Report e statistiche del popup: solo Owner, una riga per tecnico e giornata, orari pianificati.
 * Eventi manuali con date fisse: i conteggi non dipendono dal giorno in cui si lancia il test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';

function boot() {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [] });
  env.ctx.setupProduzione();
  env.token = login(env);
  return env;
}
function login(env, email = ADMIN) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return call(env.ctx, 'auth.verifyCode', { email, code }).data.token;
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const rows = (env, name) => { const [h, ...r] = env.getSS(DB).getSheetByName(name).rows(); return r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]]))); };
const utente = (env, email, nome, ruolo = 'PRODUCTION') => { ok(call(env.ctx, 'utenti.save', { email, nome, ruolo }, env.token)); return login(env, email); };
const evento = (env, titolo, data, data_fine, ora_inizio = '', ora_fine = '', luogo = '') =>
  ok(call(env.ctx, 'eventi.create', { titolo, data, data_fine, ora_inizio, ora_fine, luogo }, env.token));
const assegna = (env, ev, email, giorni) => ok(call(env.ctx, 'staff.gestisci', { evento_id: ev.id, azione: 'aggiungi', email, giorni }, env.token));
const report = (env, p = {}, token = env.token) => ok(call(env.ctx, 'report.righe', p, token));
const stat = (env, adesso) => ok(call(env.ctx, 'report.statistiche', { adesso }, env.token));

test('permessi: report e statistiche solo all\'Owner, anche chiamando l\'API direttamente', () => {
  const env = boot();
  const prod = utente(env, 'prod@example.com', 'Paola Neri');
  const view = utente(env, 'view@example.com', 'Vito Bruni', 'VIEWER');
  const ex = utente(env, 'extra@example.com', 'Elena Riva', 'VIEWER');
  ok(call(env.ctx, 'utenti.save', { email: 'extra@example.com', nome: 'Elena Riva', ruolo: 'VIEWER', permessi_extra: ['tutti_documenti', 'carica', 'modifica'] }, env.token));
  for (const azione of ['report.righe', 'report.statistiche']) {
    for (const t of [prod, view, ex]) assert.equal(call(env.ctx, azione, {}, t).error.code, 'FORBIDDEN', azione);
    assert.equal(call(env.ctx, azione, {}, '').error.code, 'AUTH_REQUIRED');
    assert.equal(call(env.ctx, azione, {}, 'token-inventato').error.code, 'AUTH_REQUIRED');
    assert.equal(call(env.ctx, azione, {}, env.token).ok, true);
  }
});

test('tre giornate = tre righe, una per tecnico e giornata, nessun duplicato anche dopo modifiche e riassegnazioni', () => {
  const env = boot();
  utente(env, 'marco@example.com', 'Marco Serra');
  utente(env, 'anna@example.com', 'Anna Maria De Luca');
  const e = evento(env, 'Festival', '2026-11-10', '2026-11-12', '', '', 'Castello, Lecce');
  assegna(env, e, 'marco@example.com');
  assegna(env, e, 'anna@example.com');
  let r = report(env);
  assert.equal(r.righe.length, 6);
  assert.equal(r.totali.giornate, 6);
  assert.deepEqual(r.righe.filter(x => x.email === 'marco@example.com').map(x => x.data), ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.deepEqual(r.righe.filter(x => x.email === 'marco@example.com').map(x => `${x.n}/${x.di}`), ['1/3', '2/3', '3/3']);
  const a = r.righe.find(x => x.email === 'anna@example.com');
  assert.deepEqual([a.nome, a.cognome, a.tecnico, a.evento, a.location, a.giorno], ['Anna', 'Maria De Luca', 'Anna Maria De Luca', 'Festival', 'Castello, Lecce', 'Martedì']);
  assert.equal(r.righe.filter(x => x.data === '2026-11-10')[0].giorno, 'Martedì');
  assert.equal(r.righe[0].giorno, 'Martedì');

  // togli e riassegna, modifica le date dell'evento: sempre una riga per tecnico e giornata
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'rimuovi', email: 'anna@example.com' }, env.token));
  assert.equal(report(env).righe.length, 3);
  assegna(env, e, 'anna@example.com');
  ok(call(env.ctx, 'eventi.update', { id: e.id, versione: ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).versione, data_fine: '2026-11-13' }, env.token));
  r = report(env);
  assert.equal(r.righe.length, 8);
  const chiavi = r.righe.map(x => x.email + x.data);
  assert.equal(new Set(chiavi).size, chiavi.length);
  // assegnata solo a due giornate
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'giorni', email: 'anna@example.com', giorni: [ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).giorni[0].id] }, env.token));
  assert.equal(report(env, { email: 'anna@example.com' }).righe.length, 1);
});

test('orari pianificati, durata e giornata che finisce dopo la mezzanotte', () => {
  const env = boot();
  utente(env, 'marco@example.com', 'Marco Serra');
  const sera = evento(env, 'Serata', '2026-11-20', '2026-11-20', '21:00', '23:30');
  const notte = evento(env, 'Notte', '2026-11-21', '2026-11-21', '22:00', '02:00');
  const senza = evento(env, 'Senza orari', '2026-11-22', '2026-11-22');
  [sera, notte, senza].forEach(e => assegna(env, e, 'marco@example.com'));
  const r = report(env);
  const x = (t) => r.righe.find(y => y.evento === t);
  assert.deepEqual([x('Serata').ora_inizio, x('Serata').ora_fine, x('Serata').durata_min, x('Serata').durata_ore], ['21:00', '23:30', 150, 2.5]);
  assert.deepEqual([x('Notte').data, x('Notte').durata_min, x('Notte').durata_ore, x('Notte').dopo_mezzanotte], ['2026-11-21', 240, 4, true]);
  assert.deepEqual([x('Senza orari').durata_min, x('Senza orari').ora_inizio], [null, '']);
  assert.deepEqual([r.totali.giornate, r.totali.minuti, r.totali.ore, r.totali.senza_orario], [3, 390, 6.5, 1]);
  assert.deepEqual(r.per_tecnico, [{ email: 'marco@example.com', nome: 'Marco Serra', giornate: 3, minuti: 390, ore: 6.5 }]);

  // l'orario del turno vince su quello della giornata; la giornata modificata si riflette
  const g = ok(call(env.ctx, 'eventi.get', { id: sera.id }, env.token)).giorni[0];
  ok(call(env.ctx, 'giorni.salva', { id: g.id, versione: g.versione, ora_inizio: '20:00' }, env.token));
  assert.equal(report(env).righe.find(y => y.evento === 'Serata').durata_min, 210);
  ok(call(env.ctx, 'turni.salva', { evento_id: sera.id, giorno_id: g.id, email: 'marco@example.com', ora_inizio: '18:00', ora_fine: '' }, env.token));
  const s = report(env).righe.find(y => y.evento === 'Serata');
  assert.deepEqual([s.ora_inizio, s.ora_fine, s.durata_min], ['18:00', '23:30', 330]);
});

test('filtri per mese e anno: la giornata notturna resta nel mese in cui inizia, il cambio d\'anno separa i periodi', () => {
  const env = boot();
  utente(env, 'marco@example.com', 'Marco Serra');
  const ev = [
    evento(env, 'Fine novembre notte', '2026-11-30', '2026-11-30', '22:00', '03:00'),
    evento(env, 'Inizio dicembre', '2026-12-01', '2026-12-01', '10:00', '12:00'),
    evento(env, 'Capodanno', '2026-12-31', '2026-12-31', '22:00', '04:00'),
    evento(env, 'Befana', '2027-01-06', '2027-01-06', '10:00', '12:00'),
    evento(env, 'A cavallo di mese', '2026-11-29', '2026-12-02')
  ];
  ev.forEach(e => assegna(env, e, 'marco@example.com'));
  const nomi = (p) => report(env, p).righe.map(r => r.evento + '@' + r.data);
  assert.deepEqual(nomi({ anno: 2026, mese: 11 }), ['A cavallo di mese@2026-11-29', 'Fine novembre notte@2026-11-30', 'A cavallo di mese@2026-11-30']);
  assert.deepEqual(nomi({ anno: 2026, mese: 12 }), ['Inizio dicembre@2026-12-01', 'A cavallo di mese@2026-12-01', 'A cavallo di mese@2026-12-02', 'Capodanno@2026-12-31']);
  assert.deepEqual(nomi({ anno: 2027 }), ['Befana@2027-01-06']);
  assert.equal(report(env, { anno: 2026 }).righe.length, 7);
  assert.deepEqual(report(env).filtri.anni, ['2026', '2027']);
  assert.equal(report(env, { anno: 2026, mese: 12 }).totali.giornate, 4);
  assert.equal(report(env, { da: '2026-11-30', a: '2026-12-01' }).righe.length, 4);
  assert.equal(report(env, { anno: 2026, mese: 12 }).periodo.mese, '12');
  assert.equal(call(env.ctx, 'report.righe', { anno: 'x' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'report.righe', { anno: 2026, mese: 13 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'report.righe', { da: 'boh' }, env.token).error.code, 'INVALID');
  // il Capodanno 22:00–04:00 conta 6 ore, tutte nella giornata del 31
  assert.equal(report(env, { anno: 2026, mese: 12 }).righe.find(r => r.evento === 'Capodanno').durata_ore, 6);
});

test('filtri per tecnico ed evento, storico per persona', () => {
  const env = boot();
  utente(env, 'marco@example.com', 'Marco Serra');
  utente(env, 'giulia@example.com', 'Giulia Rao');
  const a = evento(env, 'Uno', '2026-11-10', '2026-11-10', '10:00', '12:00');
  const b = evento(env, 'Due', '2026-11-11', '2026-11-12', '', '');
  assegna(env, a, 'marco@example.com'); assegna(env, b, 'marco@example.com'); assegna(env, b, 'giulia@example.com');
  assert.equal(report(env, { email: 'marco@example.com' }).righe.length, 3);
  assert.equal(report(env, { email: 'giulia@example.com' }).totali.giornate, 2);
  assert.equal(report(env, { evento_id: b.id }).righe.length, 4);
  assert.equal(report(env, { evento_id: b.id, email: 'giulia@example.com' }).righe.length, 2);
  const f = report(env).filtri;
  assert.deepEqual(f.tecnici.map(t => t.nome), ['Giulia Rao', 'Marco Serra']);
  assert.deepEqual(f.eventi.map(t => t.titolo), ['Due', 'Uno']);
});

test('eventi annullati: restano nel report segnalati ma non entrano nei totali', () => {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [
    { id: 'a@g', title: 'Concerto', allDay: false, start: new Date(Date.now() + 3 * 86400000).toISOString(), end: new Date(Date.now() + 3 * 86400000 + 7200000).toISOString(), description: '' }
  ] });
  env.ctx.setupProduzione();
  env.token = login(env);
  utente(env, 'marco@example.com', 'Marco Serra');
  const e = ok(call(env.ctx, 'eventi.list', {}, env.token))[0];
  assegna(env, e, 'marco@example.com');
  let r = report(env);
  assert.deepEqual([r.totali.giornate, r.totali.ore, r.righe[0].annullato], [1, 2, false]);
  env.state.calendar.events = [];
  ok(call(env.ctx, 'sync.run', {}, env.token));
  r = report(env);
  assert.equal(r.righe.length, 1, 'la riga resta');
  assert.deepEqual([r.righe[0].annullato, r.righe[0].stato_evento, r.totali.giornate, r.totali.ore, r.totali.annullate], [true, 'annullato', 0, 0, 1]);
  assert.deepEqual(r.per_tecnico, []);
  assert.equal(report(env, { annullati: false }).righe.length, 0);
});

test('nessun dato storico viene toccato: utente eliminato o email cambiata, le giornate passate restano', () => {
  const env = boot();
  utente(env, 'marco@example.com', 'Marco Serra');
  const passato = evento(env, 'Passato', '2020-05-10', '2020-05-10', '10:00', '12:00');
  const futuro = evento(env, 'Futuro', '2099-05-10', '2099-05-10', '10:00', '12:00');
  assegna(env, passato, 'marco@example.com'); assegna(env, futuro, 'marco@example.com');
  ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', email_nuova: 'm.serra@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }, env.token));
  assert.equal(report(env, { email: 'm.serra@example.com' }).righe.length, 2);
  ok(call(env.ctx, 'utenti.elimina', { email: 'm.serra@example.com' }, env.token));
  const r = report(env);
  assert.deepEqual(r.righe.map(x => [x.evento, x.tecnico]), [['Passato', 'Marco Serra']], 'resta la giornata già svolta, col nome');
});

test('statistiche del popup: giornate lavorate, future e ore del mese corrente', () => {
  const env = boot();
  const marco = utente(env, 'marco@example.com', 'Marco Serra');
  const luca = utente(env, 'luca@example.com', 'Luca Bianchi');
  const E = [
    evento(env, 'Passata 1', '2026-11-03', '2026-11-03', '20:00', '23:00'),          // 3 h, conclusa
    evento(env, 'Passata 2 notte', '2026-11-10', '2026-11-10', '22:00', '02:00'),    // 4 h, conclusa
    evento(env, 'Passata senza orari', '2026-11-12', '2026-11-12'),                  // conclusa dal giorno dopo, nessuna ora
    evento(env, 'Oggi sera', '2026-11-18', '2026-11-18', '21:00', '23:00'),          // alle 12:00 è ancora da svolgere
    evento(env, 'Oggi senza orari', '2026-11-18', '2026-11-18'),                     // oggi senza orari: futura
    evento(env, 'Tre giorni', '2026-11-25', '2026-11-27'),                           // 3 future
    evento(env, 'Altro mese', '2026-12-05', '2026-12-05', '10:00', '12:00'),         // fuori mese
    evento(env, 'Mese scorso', '2026-10-30', '2026-10-30', '10:00', '12:00')         // fuori mese
  ];
  E.forEach(e => assegna(env, e, 'marco@example.com'));
  assegna(env, E[0], 'luca@example.com');
  const get = (s, email) => s.persone.find(p => p.email === email);
  let s = stat(env, '2026-11-18T12:00');
  assert.equal(s.mese, '2026-11');
  assert.deepEqual(get(s, 'marco@example.com'), { email: 'marco@example.com', id: get(s, 'marco@example.com').id, giornate_lavorate: 3, giornate_future: 5, ore_lavorate: 7 });
  assert.deepEqual([get(s, 'luca@example.com').giornate_lavorate, get(s, 'luca@example.com').giornate_future, get(s, 'luca@example.com').ore_lavorate], [1, 0, 3]);
  assert.ok(get(s, 'marco@example.com').id.startsWith('usr'), 'id utente per agganciare il popup al nome');
  // alle 23:30 la serata di oggi è conclusa: +1 giornata, +2 ore; "oggi senza orari" resta futura fino a domani
  s = stat(env, '2026-11-18T23:30');
  assert.deepEqual([get(s, 'marco@example.com').giornate_lavorate, get(s, 'marco@example.com').giornate_future, get(s, 'marco@example.com').ore_lavorate], [4, 4, 9]);
  s = stat(env, '2026-11-19T08:00');
  assert.deepEqual([get(s, 'marco@example.com').giornate_lavorate, get(s, 'marco@example.com').giornate_future], [5, 3]);
  // la notte 22:00–02:00 non è conclusa alle 01:00 della notte stessa (fine alle 02:00 del giorno dopo)
  s = stat(env, '2026-11-11T01:00');
  assert.equal(get(s, 'marco@example.com').giornate_lavorate, 1);
  // mese diverso = altri numeri
  s = stat(env, '2026-12-06T09:00');
  assert.deepEqual([s.mese, get(s, 'marco@example.com').giornate_lavorate, get(s, 'marco@example.com').giornate_future], ['2026-12', 1, 0]);
  assert.equal(call(env.ctx, 'report.statistiche', { adesso: 'ieri' }, env.token).error.code, 'INVALID');
  void marco;
});

test('statistiche: gli eventi annullati e gli altri mesi non contano', () => {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [
    { id: 'a@g', title: 'Concerto', allDay: true, start: '2026-11-20', end: '2026-11-21', description: '' }
  ] });
  env.ctx.setupProduzione();
  env.token = login(env);
  utente(env, 'marco@example.com', 'Marco Serra');
  const e = ok(call(env.ctx, 'eventi.list', {}, env.token))[0];
  assegna(env, e, 'marco@example.com');
  assert.equal(stat(env, '2026-11-18T12:00').persone[0].giornate_future, 1);
  env.state.calendar.events = [];
  ok(call(env.ctx, 'sync.run', {}, env.token));
  assert.deepEqual(stat(env, '2026-11-18T12:00').persone, [], 'annullato: nessun conteggio');
});
