/**
 * File allegati agli eventi (piano, materiale, scheda) su Drive.
 * Backend vero con i servizi Google simulati.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';
const EVENTI = '1tm4vwnFy7DuOI7WKOhBwO-5V8e58njld';

function isoDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
}

function boot() {
  const env = loadBackend({
    adminEmail: ADMIN,
    calendarEvents: [{ id: 'a@google.com', title: 'Cantelmo: Concerto / prova', allDay: true, start: isoDay(3), end: isoDay(4) }]
  });
  env.ctx.setupProduzione();
  env.token = login(env);
  env.ev = call(env.ctx, 'eventi.list', {}, env.token).data[0];
  return env;
}

function login(env, email = ADMIN) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return call(env.ctx, 'auth.verifyCode', { email, code }).data.token;
}

function utente(env, email, ruolo, extra = {}) {
  const r = call(env.ctx, 'utenti.save', { email, nome: email, ruolo, ...extra }, env.token);
  assert.equal(r.ok, true, JSON.stringify(r));
  return login(env, email);
}

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const rows = (env, name) => env.getSS(DB).getSheetByName(name).rows();
const b64 = (s) => Buffer.from(s).toString('base64');

test('permessi: il Viewer vede e scarica ma non carica; Production carica', () => {
  const env = boot();
  const lett = utente(env, 'tecnico@example.com', 'VIEWER');
  const coll = utente(env, 'collab@example.com', 'PRODUCTION');
  const file = { evento_id: env.ev.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: b64('%PDF-1.4 test') };
  assert.equal(call(env.ctx, 'allegati.carica', file, lett).error.code, 'FORBIDDEN');
  ok(call(env.ctx, 'allegati.carica', file, coll));
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, lett));
  assert.equal(ev.allegati.scheda.length, 1);
  const d = ok(call(env.ctx, 'allegati.scarica', { id: ev.allegati.scheda[0].id }, lett));
  assert.equal(Buffer.from(d.dati, 'base64').toString(), '%PDF-1.4 test');
  assert.equal(call(env.ctx, 'allegati.carica', { ...file, sezione: 'cucina' }, coll).error.code, 'INVALID');
});

test('allegati: cartella dell\'evento creata una volta, file su Drive, scarica identico, versione evento invariata', () => {
  const env = boot();
  const before = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, env.token));
  // contenuto binario con tutti i valori di byte, per verificare che nulla si alteri
  const bin = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  let s = ok(call(env.ctx, 'allegati.carica', { evento_id: env.ev.id, sezione: 'piano', nome: 'piano/v2.pdf', mime: 'application/pdf', dati: bin.toString('base64') }, env.token));
  s = ok(call(env.ctx, 'allegati.carica', { evento_id: env.ev.id, sezione: 'materiale', nome: 'foto.jpg', mime: 'image/jpeg', dati: b64('jpg') }, env.token));
  const folders = [...env.state.drive.folders.values()].filter(f => f.parent === EVENTI);
  assert.equal(folders.length, 1, 'una sola cartella per evento');
  assert.equal(folders[0].name, `${isoDay(3)} · Cantelmo: Concerto prova`.replace(':', ' ').replace(/\s+/g, ' '));
  const files = [...env.state.drive.files.values()].filter(f => f.parent === folders[0].id);
  assert.deepEqual(files.map(f => f.name).sort(), ['foto.jpg', 'piano-v2.pdf']);

  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, env.token));
  assert.equal(ev.versione, before.versione, 'creare la cartella non deve far scattare il conflitto sulle note');
  assert.ok(ev.cartella_url.endsWith(folders[0].id));
  const al = ev.allegati.piano[0];
  assert.deepEqual({ nome: al.nome, mime: al.mime, byte: al.byte, da: al.caricato_da }, { nome: 'piano-v2.pdf', mime: 'application/pdf', byte: 256, da: ADMIN });
  const d = ok(call(env.ctx, 'allegati.scarica', { id: al.id }, env.token));
  assert.ok(Buffer.from(d.dati, 'base64').equals(bin), 'il file scaricato è identico a quello caricato');
  assert.deepEqual(ev.stato_doc, { piano: true, materiale: true, scheda: false });
  // salvare le note dopo il caricamento funziona senza conflitto
  ok(call(env.ctx, 'eventi.update', { id: env.ev.id, versione: before.versione, note: 'ok' }, env.token));
});

test('allegati: file vuoto, troppo grande, non base64, mime strano, Drive in errore', () => {
  const env = boot();
  const base = { evento_id: env.ev.id, sezione: 'scheda', nome: 'a.pdf', mime: 'application/pdf' };
  assert.equal(call(env.ctx, 'allegati.carica', { ...base, dati: '' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'allegati.carica', { ...base, dati: 'A'.repeat(28 * 1024 * 1024) }, env.token).error.code, 'TOO_LARGE');
  assert.equal(call(env.ctx, 'allegati.carica', { ...base, dati: '***' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'allegati.carica', { ...base, nome: '', dati: b64('x') }, env.token).error.code, 'INVALID');
  const s = ok(call(env.ctx, 'allegati.carica', { ...base, mime: 'text/html; <script>', dati: b64('x') }, env.token));
  assert.equal(s.allegati[0].mime, 'application/octet-stream');
  env.state.driveFail = true;
  const r = call(env.ctx, 'allegati.carica', { ...base, dati: b64('y') }, env.token);
  assert.equal(r.error.code, 'SERVER');
  assert.equal(rows(env, 'allegati').length, 2, 'nessuna riga orfana se Drive fallisce');
});

test('allegati: si tolgono nel cestino di Drive; solo admin o chi ha caricato', () => {
  const env = boot();
  const c1 = utente(env, 'c1@example.com', 'PRODUCTION');
  const c2 = utente(env, 'c2@example.com', 'PRODUCTION');
  const s = ok(call(env.ctx, 'allegati.carica', { evento_id: env.ev.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: b64('r') }, c1));
  const id = s.allegati[0].id;
  assert.equal(call(env.ctx, 'allegati.elimina', { id }, c2).error.code, 'FORBIDDEN');
  const after = ok(call(env.ctx, 'allegati.elimina', { id }, c1));
  assert.equal(after.allegati.length, 0);
  const f = [...env.state.drive.files.values()].find(x => x.name === 'rider.pdf');
  assert.equal(f.trashed, true, 'nel cestino di Drive, recuperabile');
  assert.equal(call(env.ctx, 'allegati.scarica', { id }, env.token).error.code, 'NOT_FOUND');
  assert.equal(call(env.ctx, 'allegati.elimina', { id }, env.token).error.code, 'NOT_FOUND');
  assert.equal(ok(call(env.ctx, 'eventi.list', {}, env.token))[0].stato_doc.scheda, false);
});

test('ambiente di test: i file finiscono nella cartella EVENTI di _TEST', () => {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [{ id: 'a@google.com', title: 'Prova', allDay: true, start: isoDay(3), end: isoDay(4) }] });
  env.ctx.setupTest();
  const t = login(env);
  const ev = call(env.ctx, 'eventi.list', {}, t).data[0];
  ok(call(env.ctx, 'allegati.carica', { evento_id: ev.id, sezione: 'piano', nome: 'p.pdf', mime: 'application/pdf', dati: b64('p') }, t));
  const folder = [...env.state.drive.folders.values()].find(f => f.parent);
  assert.equal(folder.parent, '17x8B43it-ZGY9XAk5J2RswHak-UGL_aI');
});
