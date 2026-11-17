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


const assegna = (env, titolo, ...emails) => emails.forEach(email => ok(call(env.ctx, 'staff.gestisci', { evento_id: env.ev(titolo).id, azione: 'aggiungi', email }, env.token)));
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
  const lett = utente(env, 'tecnico@example.com', 'VIEWER');
  assegna(env, 'Cantelmo', 'tecnico@example.com');
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

// ---------- PDF archiviato come file dell'evento ----------
const PDF_B64 = (testo = 'uno') => Buffer.from('%PDF-1.4\n' + testo).toString('base64');
const salvaPdf = (env, pid, tipo, nome, dati = PDF_B64(), token = env.token) => call(env.ctx, 'documento.pdf', { produzione_id: pid, tipo, nome, dati }, token);
const NOME_P = (d = '2026-11-20') => `Production Plan - Cantelmo - ${d}.pdf`;

test('PDF: viene salvato come file dell\'evento, accende l\'indicatore e si scarica identico', () => {
  const env = boot();
  const p = assicura(env);
  const prima = ok(call(env.ctx, 'eventi.list', {}, env.token)).find(e => e.id === env.ev('Cantelmo').id);
  assert.deepEqual(prima.stato_doc, { piano: false, materiale: false, scheda: false });
  ok(salvaDoc(env, p.id, 'plan', '0', PLAN()));
  ok(salvaPdf(env, p.id, 'plan', NOME_P()));
  const dopo = ok(call(env.ctx, 'eventi.list', {}, env.token)).find(e => e.id === env.ev('Cantelmo').id);
  assert.deepEqual(dopo.stato_doc, { piano: true, materiale: false, scheda: false });
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev('Cantelmo').id }, env.token));
  assert.equal(ev.allegati.piano.length, 1);
  assert.equal(ev.allegati.piano[0].nome, NOME_P());
  const f = ok(call(env.ctx, 'allegati.scarica', { id: ev.allegati.piano[0].id }, env.token));
  assert.equal(Buffer.from(f.dati, 'base64').toString(), '%PDF-1.4\nuno');
  // il Material List va nella sezione materiale
  ok(salvaPdf(env, p.id, 'materiali', 'Material List - Cantelmo - 2026-11-20.pdf'));
  const ev2 = ok(call(env.ctx, 'eventi.get', { id: env.ev('Cantelmo').id }, env.token));
  assert.equal(ev2.allegati.materiale.length, 1);
});

test('PDF: un nuovo salvataggio sostituisce il precedente (uno solo visibile), il vecchio va nel cestino di Drive; altri file restano', () => {
  const env = boot();
  const p = assicura(env);
  const eid = env.ev('Cantelmo').id;
  ok(call(env.ctx, 'allegati.carica', { evento_id: eid, sezione: 'piano', nome: 'rider-band.pdf', mime: 'application/pdf', dati: PDF_B64('rider') }, env.token));
  ok(salvaPdf(env, p.id, 'plan', NOME_P(), PDF_B64('v1')));
  ok(salvaPdf(env, p.id, 'plan', NOME_P(), PDF_B64('v2')));
  const ev = ok(call(env.ctx, 'eventi.get', { id: eid }, env.token));
  assert.deepEqual(ev.allegati.piano.map(a => a.nome).sort(), [NOME_P(), 'rider-band.pdf']);
  const mio = ev.allegati.piano.find(a => a.nome === NOME_P());
  assert.equal(Buffer.from(ok(call(env.ctx, 'allegati.scarica', { id: mio.id }, env.token)).dati, 'base64').toString(), '%PDF-1.4\nv2');
  const files = [...env.state.drive.files.values()].filter(f => f.name === NOME_P());
  assert.equal(files.length, 2);
  assert.equal(files.filter(f => f.trashed).length, 1);
  assert.equal(rows(env, 'storico').filter(r => r[3] === 'piano' && r[4] === 'allegato_sostituito').length, 1);
});

test('PDF: festival, il file va in tutti gli eventi collegati', () => {
  const env = boot();
  const p = assicura(env, 'Festival · giorno 1');
  ok(call(env.ctx, 'produzione.collega', { id: p.id, evento_id: env.ev('Festival · giorno 3').id }, env.token));
  const r = ok(salvaPdf(env, p.id, 'plan', 'Production Plan - Festival - 2026-11-27.pdf'));
  assert.equal(r.eventi.length, 2);
  for (const t of ['Festival · giorno 1', 'Festival · giorno 3']) {
    const l = ok(call(env.ctx, 'eventi.list', {}, env.token)).find(e => e.id === env.ev(t).id);
    assert.equal(l.stato_doc.piano, true, t);
  }
});

test('PDF: rifiuta nome sbagliato, file non PDF, tipo/produzione inesistenti e chi non può modificare; Drive in errore non lascia righe', () => {
  const env = boot();
  const p = assicura(env);
  assert.equal(salvaPdf(env, p.id, 'plan', 'Material List - x.pdf').error.code, 'INVALID');
  assert.equal(salvaPdf(env, p.id, 'plan', '../Production Plan - x.pdf').error.code, 'INVALID');
  assert.equal(salvaPdf(env, p.id, 'plan', NOME_P(), Buffer.from('MZ non pdf').toString('base64')).error.code, 'INVALID');
  assert.equal(salvaPdf(env, p.id, 'plan', NOME_P(), '').error.code, 'INVALID');
  assert.equal(salvaPdf(env, p.id, 'boh', NOME_P()).error.code, 'INVALID');
  assert.equal(salvaPdf(env, 'prj_inesistente', 'plan', NOME_P()).error.code, 'NOT_FOUND');
  const lett = utente(env, 'lettore@example.com', 'VIEWER');
  assert.equal(salvaPdf(env, p.id, 'plan', NOME_P(), PDF_B64(), lett).error.code, 'FORBIDDEN');
  env.state.driveFail = true;
  assert.equal(salvaPdf(env, p.id, 'plan', NOME_P()).ok, false);
  env.state.driveFail = false;
  assert.equal(rows(env, 'allegati').length, 1); // solo l'intestazione: nessun allegato registrato
});
