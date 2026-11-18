/**
 * 0.12.1 · Load-in e Load-out del Production Plan nell'anteprima dell'evento (eventi.list / eventi.get).
 * Visibili solo a chi può vedere i documenti dell'evento; letti dal piano, mai scritti.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
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
const piano = (env, ev, giorni) => {
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: ev.id }, env.token));
  ok(call(env.ctx, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '0', dati: { crew: [], giorni } }, env.token));
};
const giorniDi = (env, token, id) => ok(call(env.ctx, 'eventi.list', {}, token)).find(e => e.id === id).giorni;

test('load-in e load-out: letti dal piano giornata per giornata, con orari normalizzati e righe multiple', () => {
  const env = boot();
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Festival', data: '2026-11-18', data_fine: '2026-11-19', ora_inizio: '', ora_fine: '' }, env.token));
  piano(env, e, [
    { data: '2026-11-18', righe: [
      { att: 'Soundcheck', ora: '16:00' }, { att: 'Load-in', ora: '9:30' }, { att: 'Load in', ora: '08:00' },
      { att: 'Load-out', ora: '23:30' }, { att: 'load-out', ora: '01:15' }, { att: 'Load-out', ora: 'TBD' }] },
    { data: '2026-11-19', righe: [{ att: 'Show Start', ora: '21:00' }, { att: 'Load-out', ora: '23.45' }] }
  ]);
  const g = giorniDi(env, env.token, e.id);
  assert.deepEqual(g[0].plan, { load_in: '08:00', load_out: '23:30' });
  assert.deepEqual(g[1].plan, { load_in: '', load_out: '23:45' });
});

test('senza piano o senza Load-in/Load-out: nessun dato; altra data del piano non si applica', () => {
  const env = boot();
  const a = ok(call(env.ctx, 'eventi.create', { titolo: 'Senza piano', data: '2026-11-20', data_fine: '2026-11-20' }, env.token));
  const b = ok(call(env.ctx, 'eventi.create', { titolo: 'Piano altra data', data: '2026-11-21', data_fine: '2026-11-21' }, env.token));
  piano(env, b, [{ data: '2026-11-22', righe: [{ att: 'Load-in', ora: '10:00' }] }]);
  const c = ok(call(env.ctx, 'eventi.create', { titolo: 'Solo show', data: '2026-11-23', data_fine: '2026-11-23' }, env.token));
  piano(env, c, [{ data: '2026-11-23', righe: [{ att: 'Show Start', ora: '21:00' }] }]);
  for (const id of [a.id, b.id, c.id]) assert.equal(giorniDi(env, env.token, id)[0].plan, null);
});

test('chi non può vedere i documenti dell\'evento non riceve Load-in e Load-out; lo staff assegnato sì', () => {
  const env = boot();
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Concerto', data: '2026-11-18', data_fine: '2026-11-18' }, env.token));
  piano(env, e, [{ data: '2026-11-18', righe: [{ att: 'Load-in', ora: '14:00' }, { att: 'Load-out', ora: '01:00' }] }]);
  ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }, env.token));
  ok(call(env.ctx, 'utenti.save', { email: 'paola@example.com', nome: 'Paola Neri', ruolo: 'PRODUCTION' }, env.token));
  const marco = login(env, 'marco@example.com');
  const paola = login(env, 'paola@example.com');
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'marco@example.com' }, env.token));
  assert.deepEqual(giorniDi(env, marco, e.id)[0].plan, { load_in: '14:00', load_out: '01:00' });
  assert.deepEqual(giorniDi(env, env.token, e.id)[0].plan, { load_in: '14:00', load_out: '01:00' });
  assert.equal(giorniDi(env, paola, e.id)[0].plan, null, 'non assegnata: niente documenti');
});

test('l\'anteprima non scrive nulla: il piano resta identico dopo la lettura dell\'elenco', () => {
  const env = boot();
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Concerto', data: '2026-11-18', data_fine: '2026-11-18' }, env.token));
  piano(env, e, [{ data: '2026-11-18', righe: [{ att: 'Load-in', ora: '9:30' }] }]);
  const pr = ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).produzione_id;
  const prima = ok(call(env.ctx, 'documento.get', { produzione_id: pr, tipo: 'plan' }, env.token));
  giorniDi(env, env.token, e.id);
  const dopo = ok(call(env.ctx, 'documento.get', { produzione_id: pr, tipo: 'plan' }, env.token));
  assert.equal(dopo.versione, prima.versione);
  assert.equal(dopo.dati.giorni[0].righe[0].ora, '9:30');
});
