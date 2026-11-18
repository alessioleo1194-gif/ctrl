/**
 * 0.13.0 · Prestazioni: avvio in una chiamata, meno letture dei fogli per richiesta,
 * risposte delle scritture complete (evento aggiornato incluso) per evitare chiamate in più.
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

/** Esegue `fn` contando quante volte ogni foglio viene letto per intero (ogni lettura costa 100-400 ms su Apps Script). */
function contaLetture(env, fn) {
  const proto = Object.getPrototypeOf(env.getSS(DB).getSheetByName('eventi'));
  const orig = proto.getDataRange;
  const per = {};
  proto.getDataRange = function () { const n = this.getName(); per[n] = (per[n] || 0) + 1; return orig.call(this); };
  try { fn(); } finally { proto.getDataRange = orig; }
  return per;
}

function seed() {
  const env = boot();
  ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }, env.token));
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Concerto', data: '2026-12-05', data_fine: '2026-12-05', ora_inizio: '21:00', ora_fine: '23:00' }, env.token));
  return { env, e };
}

test('app.avvio: profilo, impostazioni ed elenco eventi in una chiamata, identici alle chiamate separate', () => {
  const { env } = seed();
  const a = ok(call(env.ctx, 'app.avvio', {}, env.token));
  assert.deepEqual(a.utente, ok(call(env.ctx, 'auth.me', {}, env.token)));
  assert.deepEqual(a.impostazioni, ok(call(env.ctx, 'impostazioni.get', {}, env.token)));
  assert.deepEqual(a.eventi, ok(call(env.ctx, 'eventi.list', {}, env.token)));
  assert.equal(a.eventi.length, 1);
});

test('app.avvio richiede la sessione e rispetta i permessi di chi chiede (un Viewer vede solo i suoi eventi)', () => {
  const { env, e } = seed();
  assert.equal(call(env.ctx, 'app.avvio', {}, '').error.code, 'AUTH_REQUIRED');
  ok(call(env.ctx, 'utenti.save', { email: 'viola@example.com', nome: 'Viola Rossi', ruolo: 'VIEWER' }, env.token));
  const tv = login(env, 'viola@example.com');
  const a = ok(call(env.ctx, 'app.avvio', {}, tv));
  assert.equal(a.utente.email, 'viola@example.com');
  assert.deepEqual(a.eventi, [], 'il Viewer non assegnato non vede eventi');
  assert.deepEqual(a.eventi, ok(call(env.ctx, 'eventi.list', {}, tv)));
  assert.ok(e.id);
});

test('ogni tabella si legge al massimo una volta per richiesta (prima "utenti" si leggeva due volte)', () => {
  const { env, e } = seed();
  for (const [azione, payload] of [['auth.me', {}], ['app.avvio', {}], ['eventi.list', {}], ['eventi.get', { id: e.id }], ['staff.evento', { evento_id: e.id }], ['report.righe', {}]]) {
    const per = contaLetture(env, () => ok(call(env.ctx, azione, payload, env.token)));
    for (const [foglio, n] of Object.entries(per)) assert.ok(n <= 1, `${azione}: il foglio ${foglio} è stato letto ${n} volte`);
  }
});

test('staff.gestisci risponde con la lista dello staff E con l\'evento aggiornato (uguale a eventi.get)', () => {
  const { env, e } = seed();
  const r = ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'marco@example.com' }, env.token));
  assert.equal(r.evento_id, e.id);
  assert.equal(r.assegnati.length, 1, 'la lista dello staff c\'è ancora');
  const { evento } = r;
  assert.deepEqual(evento, ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)));
  assert.deepEqual(evento.staff.map(s => s.nome), ['Marco Serra']);
  assert.equal(evento.giorni[0].staff.length, 1);
  // anche togliere una persona riporta l'evento già aggiornato
  const r2 = ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'rimuovi', email: 'marco@example.com' }, env.token));
  assert.deepEqual(r2.evento.staff, []);
});

test('turni.salva risponde con la lista dello staff E con l\'evento aggiornato', () => {
  const { env, e } = seed();
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'marco@example.com' }, env.token));
  const g = ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).giorni[0];
  const r = ok(call(env.ctx, 'turni.salva', { evento_id: e.id, giorno_id: g.id, email: 'marco@example.com', ora_inizio: '18:00', ora_fine: '', nota: 'prova suoni' }, env.token));
  assert.equal(r.assegnati[0].turni[0].propri_inizio, '18:00');
  assert.deepEqual(r.evento, ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)));
  assert.equal(r.evento.giorni[0].staff[0].propri_inizio, '18:00');
});

test('staff.gestisci e turni.salva restano riservati all\'Owner anche con la risposta più ricca', () => {
  const { env, e } = seed();
  const tp = login(env, 'marco@example.com');
  assert.equal(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'marco@example.com' }, tp).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'turni.salva', { evento_id: e.id, giorno_id: 'x', email: 'marco@example.com' }, tp).error.code, 'FORBIDDEN');
});
