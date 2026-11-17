/**
 * Produzione e documenti operativi (Production Plan, Material List).
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


const assicura = (env, titolo = 'Cantelmo') => ok(call(env.ctx, 'produzione.assicura', { evento_id: env.ev(titolo).id }, env.token));
const get = (env, pid, tipo, token = env.token) => call(env.ctx, 'documento.get', { produzione_id: pid, tipo }, token);
const salvaDoc = (env, pid, tipo, versione, dati, token = env.token) => call(env.ctx, 'documento.salva', { produzione_id: pid, tipo, versione, dati }, token);

const PLAN = () => ({
  crew: [{ id: 'c1', nome: 'Mario Rossi', ruolo: 'FOH', telefono: '393 000', email: 'm@x.it' }],
  giorni: [{ id: 'g1', data: isoDay(3), righe: [
    { id: 'r1', sez: 'Pre Show', ora: '16:00', att: 'Load-in', loc: 'Main Stage', note: '' },
    { id: 'r2', sez: '', ora: '21:00', att: 'Show Start', loc: '', note: 'con ritardo <b>max 10</b>' }
  ] }]
});

test('assicura crea la produzione una sola volta, senza giornate né spazi inventati', () => {
  const env = boot();
  const a = assicura(env), b = assicura(env);
  assert.equal(a.id, b.id);
  assert.equal(rows(env, 'progetti').length, 2); // intestazione + 1
  assert.equal(a.nome, 'Cantelmo: Malamore + Lumiero');
  assert.deepEqual(a.documenti, { plan: null, materiali: null });
  assert.equal(ok(call(env.ctx, 'eventi.get', { id: env.ev('Cantelmo').id }, env.token)).produzione.id, a.id);
});

test('documento nuovo: get vuoto, salva, rilegge identico e la versione sale', () => {
  const env = boot();
  const p = assicura(env);
  const v0 = ok(get(env, p.id, 'plan'));
  assert.equal(v0.dati, null);
  assert.equal(v0.versione, '0');
  assert.equal(v0.eventi[0].luogo, 'Officine Cantelmo, Lecce');
  assert.ok(v0.catalogo_attivita.includes('Soundcheck'));
  const s = ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  assert.equal(s.conflitto, false);
  assert.equal(s.versione, '1');
  const r = ok(get(env, p.id, 'plan'));
  assert.equal(r.versione, '1');
  assert.equal(r.dati.crew[0].nome, 'Mario Rossi');
  assert.equal(r.dati.giorni[0].righe[1].att, 'Show Start');
  assert.equal(ok(salvaDoc(env, p.id, 'plan', '1', r.dati)).versione, '2');
  assert.equal(ok(call(env.ctx, 'eventi.get', { id: env.ev('Cantelmo').id }, env.token)).produzione.documenti.plan.versione, '2');
});

test('conflitto: una versione vecchia non scrive e restituisce il documento attuale come dato', () => {
  const env = boot();
  const p = assicura(env);
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  const altro = PLAN(); altro.crew[0].nome = 'Luca';
  const r = ok(salvaDoc(env, p.id, 'plan', '0', altro));
  assert.equal(r.conflitto, true);
  assert.equal(r.versione, '1');
  assert.equal(r.dati.crew[0].nome, 'Mario Rossi');
  assert.equal(ok(get(env, p.id, 'plan')).dati.crew[0].nome, 'Mario Rossi');
});

test('permessi: la lettura legge ma non salva né crea la produzione', () => {
  const env = boot();
  const p = assicura(env);
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  const lett = utente(env, 'tecnico@example.com', 'LETTURA');
  assert.equal(ok(get(env, p.id, 'plan', lett)).dati.crew.length, 1);
  assert.equal(ok(get(env, p.id, 'plan', lett)).permessi.modificare, false);
  assert.equal(salvaDoc(env, p.id, 'plan', '1', PLAN(), lett).ok, false);
  assert.equal(call(env.ctx, 'produzione.assicura', { evento_id: env.ev('Festival').id }, lett).ok, false);
  assert.equal(call(env.ctx, 'documento.get', { produzione_id: p.id, tipo: 'plan' }, 'token-falso').ok, false);
});

test('pulizia: tipo e produzione inesistenti rifiutati; testo troncato, id sistemati, limiti rispettati', () => {
  const env = boot();
  const p = assicura(env);
  assert.equal(get(env, p.id, 'altro').ok, false);
  assert.equal(get(env, 'pr_inesistente', 'plan').ok, false);
  const sporco = { crew: [{ nome: 'A'.repeat(500), ruolo: 'x\u0000y' }], giorni: [{ data: 'ieri', righe: [{ id: '../x y', att: 'ok' }] }], extra: 'no' };
  const r = ok(salvaDoc(env, p.id, 'plan', '0', sporco)).dati;
  assert.equal(r.crew[0].nome.length, 80);
  assert.equal(r.crew[0].ruolo, 'xy');
  assert.equal(r.giorni[0].data, '');
  assert.equal(r.giorni[0].righe[0].id, 'xy');
  assert.equal(r.extra, undefined);
  const grande = { sezioni: [{ nome: 'S', righe: Array.from({ length: 600 }, (_, i) => ({ voce: 'v' + i })) }] };
  assert.equal(ok(salvaDoc(env, p.id, 'materiali', '0', grande)).dati.sezioni[0].righe.length, 500);
});

test('documento grande: spezzato in più parti e riletto intero; riscrittura più corta non lascia resti', () => {
  const env = boot();
  const p = assicura(env);
  const grande = { sezioni: Array.from({ length: 20 }, (_, s) => ({ id: 's' + s, nome: 'Loc ' + s,
    righe: Array.from({ length: 100 }, (_, i) => ({ id: `m${s}_${i}`, voce: 'Voce lunga ' + i, qta: '1', unita: 'pcs', note: 'n'.repeat(60) })) })) };
  ok(salvaDoc(env, p.id, 'materiali', '0', grande));
  assert.ok(rows(env, 'documenti_parti').length > 2);
  const r = ok(get(env, p.id, 'materiali'));
  assert.equal(r.dati.sezioni.length, 20);
  assert.equal(r.dati.sezioni[19].righe[99].voce, 'Voce lunga 99');
  ok(salvaDoc(env, p.id, 'materiali', '1', { sezioni: [{ id: 's0', nome: 'Solo', righe: [{ id: 'a', voce: 'X' }] }] }));
  const r2 = ok(get(env, p.id, 'materiali'));
  assert.equal(r2.dati.sezioni.length, 1);
  assert.equal(r2.dati.sezioni[0].righe[0].voce, 'X');
});

test('Plan e Material List sono documenti separati della stessa produzione', () => {
  const env = boot();
  const p = assicura(env);
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  assert.equal(ok(get(env, p.id, 'materiali')).dati, null);
  ok(salvaDoc(env, p.id, 'materiali', '0', { sezioni: [{ id: 's', nome: 'FOH', righe: [{ id: 'a', voce: 'Laptop', qta: '2', unita: 'pcs' }] }] }));
  assert.equal(ok(get(env, p.id, 'plan')).versione, '1');
  assert.equal(ok(get(env, p.id, 'materiali')).dati.sezioni[0].nome, 'FOH');
});

test('festival: collegando un secondo evento i documenti sono condivisi; scollegare funziona e non lascia la scheda vuota', () => {
  const env = boot();
  const p = assicura(env, 'Festival · giorno 1');
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  const c = ok(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: env.ev('Festival · giorno 3').id }, env.token));
  assert.equal(c.tipo, 'festival');
  assert.equal(c.eventi.length, 2);
  const g3 = ok(call(env.ctx, 'eventi.get', { id: env.ev('Festival · giorno 3').id }, env.token));
  assert.equal(g3.produzione.id, p.id);
  assert.equal(ok(get(env, p.id, 'plan')).eventi.length, 2);
  assert.equal(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: env.ev('Festival · giorno 3').id }, env.token).ok, true);
  const altra = assicura(env, 'Cantelmo');
  assert.equal(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: env.ev('Cantelmo').id }, env.token).ok, false);
  assert.ok(altra.id !== p.id);
  ok(call(env.ctx, 'produzione.scollega', { id: p.id, evento_id: env.ev('Festival · giorno 3').id }, env.token));
  assert.equal(ok(get(env, p.id, 'plan')).eventi.length, 1);
  assert.equal(call(env.ctx, 'produzione.scollega', { id: p.id, evento_id: env.ev('Festival · giorno 1').id }, env.token).ok, false);
});

test('suggerimenti: nomi della crew e materiali già usati in altre produzioni, senza doppioni', () => {
  const env = boot();
  const a = assicura(env, 'Cantelmo'), b = assicura(env, 'Festival · giorno 1');
  ok(salvaDoc(env, a.id, 'plan', '0', PLAN()));
  ok(salvaDoc(env, a.id, 'materiali', '0', { sezioni: [{ id: 's', nome: 'FOH', righe: [
    { id: 'a', voce: 'Laptop', qta: '2', unita: 'pcs', note: 'Playback' }, { id: 'b', voce: 'laptop', qta: '1', unita: 'pcs' }] }] }));
  const sp = ok(get(env, b.id, 'plan')).suggerimenti;
  assert.deepEqual(sp, [{ nome: 'Mario Rossi', ruolo: 'FOH', telefono: '393 000', email: 'm@x.it' }]);
  const sm = ok(get(env, b.id, 'materiali')).suggerimenti;
  assert.deepEqual(sm, [{ voce: 'Laptop', unita: 'pcs', note: 'Playback' }]);
  assert.deepEqual(ok(get(env, a.id, 'materiali')).suggerimenti, []); // non suggerisce se stesso
});

test('storico: il salvataggio di un documento è registrato con chi e quando', () => {
  const env = boot();
  const p = assicura(env);
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  const st = rows(env, 'storico').filter(r => r[3] === 'documento');
  assert.equal(st.length, 1);
  assert.equal(st[0][1], ADMIN);
});
