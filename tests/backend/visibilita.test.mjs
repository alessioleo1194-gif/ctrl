/**
 * Chi vede quali eventi: Owner e Production tutti (passati compresi); il Viewer solo quelli a cui è assegnato,
 * passati compresi; il permesso "vede i documenti di tutti gli eventi" apre l'elenco. Il blocco è nel server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';

function isoDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
}

function boot() {
  const env = loadBackend({
    adminEmail: ADMIN,
    calendarEvents: [
      { id: 'p@google.com', title: 'Cantelmo: Passato', allDay: true, start: isoDay(-6), end: isoDay(-5), description: 'Fonico Marco' },
      { id: 'a@google.com', title: 'Cantelmo: Prossimo', allDay: true, start: isoDay(3), end: isoDay(4), description: 'Luci Giulia' },
      { id: 'b@google.com', title: 'Convegno', allDay: true, start: isoDay(8), end: isoDay(9), description: '' },
      { id: 'c@google.com', title: 'Festival · giorno 1', allDay: true, start: isoDay(12), end: isoDay(13), description: '' },
      { id: 'd@google.com', title: 'Festival · giorno 2', allDay: true, start: isoDay(13), end: isoDay(14), description: '' }
    ]
  });
  env.ctx.setupProduzione();
  env.token = login(env);
  ok(call(env.ctx, 'sync.run', {}, env.token));
  return env;
}
function login(env, email = ADMIN) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return call(env.ctx, 'auth.verifyCode', { email, code, dispositivo: 'Test' }).data.token;
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const eventi = (env, token = env.token) => ok(call(env.ctx, 'eventi.list', {}, token));
const titoli = (env, token) => eventi(env, token).map(e => e.titolo).sort();
const idDi = (env, titolo) => eventi(env).find(e => e.titolo.startsWith(titolo)).id;
const utente = (env, email, ruolo, extra = {}) => {
  ok(call(env.ctx, 'utenti.save', { email, nome: email.split('@')[0], ruolo, ...extra }, env.token));
  return login(env, email);
};
const assegna = (env, titolo, email) =>
  ok(call(env.ctx, 'staff.gestisci', { evento_id: idDi(env, titolo), azione: 'aggiungi', email }, env.token));

test('Owner e Production vedono tutti gli eventi, passati compresi, anche senza assegnazioni', () => {
  const env = boot();
  const prod = utente(env, 'prod@example.com', 'PRODUCTION');
  assert.equal(eventi(env).length, 5);
  assert.deepEqual(titoli(env, prod), titoli(env));
  assert.ok(eventi(env, prod).some(e => e.titolo === 'Cantelmo: Passato'));
});

test('Viewer: vede solo gli eventi assegnati, prossimi e passati; gli altri non compaiono per nome', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER');
  assert.deepEqual(eventi(env, v), [], 'senza assegnazioni: elenco vuoto');

  assegna(env, 'Cantelmo: Passato', 'viewer@example.com');
  assegna(env, 'Cantelmo: Prossimo', 'viewer@example.com');
  assert.deepEqual(titoli(env, v), ['Cantelmo: Passato', 'Cantelmo: Prossimo']);
  assert.equal(JSON.stringify(eventi(env, v)).includes('Convegno'), false, 'il nome di un altro evento non esce in nessun campo');

  // aprire un altro evento, anche col link diretto, risponde come se non esistesse
  const r = call(env.ctx, 'eventi.get', { id: idDi(env, 'Convegno') }, v);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_FOUND');
  assert.equal(r.error.message, 'Evento non trovato');
  assert.equal(ok(call(env.ctx, 'eventi.get', { id: idDi(env, 'Cantelmo: Passato') }, v)).titolo, 'Cantelmo: Passato');

  // lo staff dei suoi eventi si vede, quello degli altri no (non gli arrivano)
  assert.ok(Array.isArray(eventi(env, v)[0].staff));
});

test('Viewer: togliere l\'assegnazione ha effetto subito, senza nuovo login', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER');
  assegna(env, 'Convegno', 'viewer@example.com');
  assert.deepEqual(titoli(env, v), ['Convegno']);
  ok(call(env.ctx, 'staff.gestisci', { evento_id: idDi(env, 'Convegno'), azione: 'rimuovi', email: 'viewer@example.com' }, env.token));
  assert.deepEqual(eventi(env, v), []);
  assert.equal(call(env.ctx, 'eventi.get', { id: idDi(env, 'Convegno') }, v).error.code, 'NOT_FOUND');
});

test('Viewer: una semplice proposta dal Calendar non apre nulla finché l\'Owner non conferma', () => {
  const env = boot();
  const v = utente(env, 'marco@example.com', 'VIEWER');          // "Marco" è nella descrizione di Passato
  assert.deepEqual(eventi(env, v), []);
  ok(call(env.ctx, 'staff.gestisci', { evento_id: idDi(env, 'Cantelmo: Passato'), azione: 'conferma', email: 'marco@example.com' }, env.token));
  assert.deepEqual(titoli(env, v), ['Cantelmo: Passato']);
});

test('Viewer con "vede i documenti di tutti gli eventi": vede tutto l\'elenco; il profilo lo dice al client', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER');
  assert.equal(ok(call(env.ctx, 'auth.me', {}, v)).permessi.vedereEventi, false);
  ok(call(env.ctx, 'utenti.save', { email: 'viewer@example.com', nome: 'Viewer', ruolo: 'VIEWER', permessi_extra: ['tutti_documenti'] }, env.token));
  assert.equal(eventi(env, v).length, 5);
  assert.equal(ok(call(env.ctx, 'auth.me', {}, v)).permessi.vedereEventi, true);
  const prod = utente(env, 'prod@example.com', 'PRODUCTION');
  assert.equal(ok(call(env.ctx, 'auth.me', {}, prod)).permessi.vedereEventi, true);
  assert.equal(ok(call(env.ctx, 'auth.me', {}, env.token)).permessi.vedereEventi, true);
  ok(call(env.ctx, 'utenti.save', { email: 'viewer@example.com', nome: 'Viewer', ruolo: 'VIEWER', permessi_extra: [] }, env.token));
  assert.deepEqual(eventi(env, v), []);
});

test('Viewer: gli altri permessi particolari (carica, modifica) non aprono l\'elenco', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER', { permessi_extra: ['carica', 'modifica'] });
  assert.deepEqual(eventi(env, v), []);
  assert.equal(ok(call(env.ctx, 'auth.me', {}, v)).permessi.vedereEventi, false);
});

test('festival: il Viewer assegnato a un giorno vede solo quel giorno nell\'elenco', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER');
  const g1 = idDi(env, 'Festival · giorno 1'), g2 = idDi(env, 'Festival · giorno 2');
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: g1 }, env.token));
  ok(call(env.ctx, 'produzione.collega', { id: pr.id, evento_id: g2 }, env.token));
  assegna(env, 'Festival · giorno 1', 'viewer@example.com');
  assert.deepEqual(titoli(env, v), ['Festival · giorno 1']);
  assert.equal(call(env.ctx, 'eventi.get', { id: g2 }, v).error.code, 'NOT_FOUND');
});

test('Viewer: le altre azioni su un evento non suo restano rifiutate e non rivelano il titolo', () => {
  const env = boot();
  const v = utente(env, 'viewer@example.com', 'VIEWER');
  const id = idDi(env, 'Convegno');
  for (const [azione, payload] of [
    ['eventi.update', { id, note: 'x' }],
    ['allegati.carica', { evento_id: id, sezione: 'scheda', nome: 'a.pdf', mime: 'application/pdf', dati: 'JVBERi0=' }],
    ['produzione.assicura', { evento_id: id }],
    ['staff.evento', { evento_id: id }]
  ]) {
    const r = call(env.ctx, azione, payload, v);
    assert.equal(r.ok, false, azione);
    assert.equal(JSON.stringify(r).includes('Convegno'), false, azione);
  }
});
