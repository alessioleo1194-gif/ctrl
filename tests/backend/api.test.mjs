import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB_PROD = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';

function isoDay(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
}
/** Istante in fuso Roma (inverno/estate gestiti cercando l'offset reale). */
function romeTime(day, hhmm) {
  for (const off of ['+01:00', '+02:00']) {
    const d = new Date(`${day}T${hhmm}:00${off}`);
    const back = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    if (back === hhmm) return d.toISOString();
  }
  throw new Error('orario non valido');
}

function boot(events = []) {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: events });
  env.ctx.setupProduzione();
  return env;
}

function login(env, email = ADMIN) {
  env.state.cache.clear();
  const r1 = call(env.ctx, 'auth.requestCode', { email });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const mail = env.state.mails.at(-1);
  const code = mail.subject.match(/(\d{6})/)[1];
  const r2 = call(env.ctx, 'auth.verifyCode', { email, code });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  return r2.data.token;
}

function addUser(env, token, u) {
  const r = call(env.ctx, 'utenti.save', u, token);
  assert.equal(r.ok, true, JSON.stringify(r));
}

const sheetRows = (env, name) => env.getSS(DB_PROD).getSheetByName(name).rows();

test('setup: crea tabelle, admin, trigger; è idempotente', () => {
  const env = boot();
  const ss = env.getSS(DB_PROD);
  for (const t of ['eventi', 'attivita', 'materiale', 'canali', 'testi', 'allegati', 'utenti', 'sessioni', 'condivisioni', 'storico', 'config']) {
    assert.ok(ss.getSheetByName(t), 'manca ' + t);
  }
  assert.equal(ss.getSheetByName('Foglio1'), null, 'il foglio iniziale va rimosso');
  assert.equal(ss.tz, 'Europe/Rome');
  assert.equal(env.state.props.ADMIN_EMAIL, ADMIN);
  assert.equal(env.state.triggers.length, 3);
  env.ctx.setupProduzione();
  assert.equal(env.state.triggers.length, 3, 'nessun trigger duplicato');
  assert.equal(sheetRows(env, 'utenti').length, 2, 'intestazione + admin, nessun duplicato');
});

test('auth: codice corretto apre una sessione e salva solo l\'hash del token', () => {
  const env = boot();
  const token = login(env);
  assert.equal(token.length, 64);
  const sess = sheetRows(env, 'sessioni');
  assert.equal(sess.length, 2);
  assert.notEqual(sess[1][0], token);
  const me = call(env.ctx, 'auth.me', {}, token);
  assert.equal(me.ok, true);
  assert.equal(me.data.ruolo, 'ADMIN');
  assert.equal(me.data.permessi.impostazioni, true);
});

test('auth: email non autorizzata riceve la stessa risposta ma nessuna email', () => {
  const env = boot();
  const before = env.state.mails.length;
  const r = call(env.ctx, 'auth.requestCode', { email: 'sconosciuto@example.com' });
  assert.equal(r.ok, true);
  assert.equal(env.state.mails.length, before);
});

test('auth: codice errato, tentativi esauriti, codice scaduto, limite di invio', () => {
  const env = boot();
  call(env.ctx, 'auth.requestCode', { email: ADMIN });
  const again = call(env.ctx, 'auth.requestCode', { email: ADMIN });
  assert.equal(again.error.code, 'RATE_LIMIT');
  for (let i = 0; i < 4; i++) assert.equal(call(env.ctx, 'auth.verifyCode', { email: ADMIN, code: '000000' }).error.code, 'CODE_WRONG');
  assert.equal(call(env.ctx, 'auth.verifyCode', { email: ADMIN, code: '000000' }).error.code, 'CODE_EXPIRED');
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  assert.equal(call(env.ctx, 'auth.verifyCode', { email: ADMIN, code }).error.code, 'CODE_EXPIRED', 'dopo 5 errori il codice è bruciato');

  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email: ADMIN });
  const code2 = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  const realNow = env.state.now;
  env.state.now = () => realNow() + 11 * 60000;
  assert.equal(call(env.ctx, 'auth.verifyCode', { email: ADMIN, code: code2 }).error.code, 'CODE_EXPIRED');
});

test('auth: richieste senza token o con token falso vengono rifiutate', () => {
  const env = boot();
  assert.equal(call(env.ctx, 'eventi.list', {}).error.code, 'AUTH_REQUIRED');
  assert.equal(call(env.ctx, 'eventi.list', {}, 'x'.repeat(64)).error.code, 'AUTH_REQUIRED');
  assert.equal(call(env.ctx, 'azione.inesistente', {}).error.code, 'INVALID');
  assert.equal(env.ctx.handleRequest('{non json').error.code, 'INVALID');
});

test('logout chiude la sessione', () => {
  const env = boot();
  const t = login(env);
  assert.equal(call(env.ctx, 'auth.logout', {}, t).ok, true);
  assert.equal(call(env.ctx, 'auth.me', {}, t).error.code, 'AUTH_REQUIRED');
});

test('permessi: LETTURA e COLLABORATORE non possono creare eventi né gestire utenti', () => {
  const env = boot();
  const admin = login(env);
  addUser(env, admin, { email: 'lettore@example.com', nome: 'L', ruolo: 'LETTURA' });
  addUser(env, admin, { email: 'collab@example.com', nome: 'C', ruolo: 'COLLABORATORE', puo_caricare: true, puo_modificare: false });
  const lett = login(env, 'lettore@example.com');
  const coll = login(env, 'collab@example.com');
  const ev = { titolo: 'Prova', data: isoDay(5) };
  assert.equal(call(env.ctx, 'eventi.create', ev, lett).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'eventi.create', ev, coll).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'utenti.list', {}, coll).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'impostazioni.lista', { lista: 'aree', valori: ['X'] }, coll).error.code, 'FORBIDDEN');
  const me = call(env.ctx, 'auth.me', {}, coll).data;
  assert.equal(me.permessi.caricare, true);
  assert.equal(me.permessi.modificare, false);
  assert.equal(call(env.ctx, 'eventi.list', {}, lett).ok, true);
});

test('utenti: l\'admin principale non può essere declassato; disattivare chiude le sessioni', () => {
  const env = boot();
  const admin = login(env);
  assert.equal(call(env.ctx, 'utenti.save', { email: ADMIN, ruolo: 'LETTURA' }, admin).error.code, 'INVALID');
  addUser(env, admin, { email: 'x@example.com', ruolo: 'LETTURA' });
  const tx = login(env, 'x@example.com');
  assert.equal(call(env.ctx, 'auth.me', {}, tx).ok, true);
  const v = call(env.ctx, 'utenti.list', {}, admin).data.find(u => u.email === 'x@example.com').versione;
  addUser(env, admin, { email: 'x@example.com', ruolo: 'LETTURA', attivo: false, versione: v });
  assert.equal(call(env.ctx, 'auth.me', {}, tx).error.code, 'AUTH_REQUIRED');
  assert.equal(call(env.ctx, 'utenti.save', { email: 'non-email', ruolo: 'LETTURA' }, admin).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.save', { email: 'y@example.com', ruolo: 'CAPO' }, admin).error.code, 'INVALID');
});

test('eventi manuali: creazione, validazione, id testuale, conflitto di versione, storico', () => {
  const env = boot();
  const t = login(env);
  assert.equal(call(env.ctx, 'eventi.create', { titolo: '', data: isoDay(3) }, t).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'eventi.create', { titolo: 'X', data: '2026-13-40' }, t).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'eventi.create', { titolo: 'X', data: isoDay(3), ora_inizio: '25:00' }, t).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'eventi.create', { titolo: 'X', data: isoDay(3), data_fine: isoDay(1) }, t).error.code, 'INVALID');
  const r = call(env.ctx, 'eventi.create', { titolo: 'Concerto', data: isoDay(3), ora_inizio: '21:00', luogo: 'Cantelmo', colore: '#F4511E' }, t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.data.id, /^ev_[0-9a-f]{12}$/);
  assert.equal(r.data.colore, '#f4511e');
  assert.equal(r.data.origine, 'manuale');

  const u1 = call(env.ctx, 'eventi.update', { id: r.data.id, versione: r.data.versione, luogo: 'Castello' }, t);
  assert.equal(u1.ok, true);
  assert.equal(u1.data.versione, '2');
  const stale = call(env.ctx, 'eventi.update', { id: r.data.id, versione: '1', luogo: 'Altro' }, t);
  assert.equal(stale.error.code, 'CONFLICT');
  const got = call(env.ctx, 'eventi.get', { id: r.data.id }, t).data;
  assert.equal(got.luogo, 'Castello');
  assert.ok(got.storico.some(s => s.azione === 'modifica'));
  assert.equal(call(env.ctx, 'eventi.get', { id: 'ev_inesistente' }, t).error.code, 'NOT_FOUND');
});

test('ID e numeri restano testo nel foglio (difetto del test F0 corretto)', () => {
  const env = boot();
  const t = login(env);
  // forza un id che Google Sheets leggerebbe come numero scientifico
  const realUuid = env.ctx.Utilities.getUuid;
  env.ctx.Utilities.getUuid = () => '1980e060-0000-4000-8000-000000000000';
  const r = call(env.ctx, 'eventi.create', { titolo: '0123', data: isoDay(2), ora_inizio: '09:00' }, t);
  env.ctx.Utilities.getUuid = realUuid;
  const row = sheetRows(env, 'eventi').find(x => x[0] === r.data.id);
  assert.ok(row, 'id salvato come testo');
  assert.equal(typeof row[3], 'string');
  assert.equal(row[3], '0123');
  assert.equal(row[6], '09:00');
});

test('archiviazione: solo admin; archiviati esclusi dalla lista salvo richiesta', () => {
  const env = boot();
  const t = login(env);
  const e = call(env.ctx, 'eventi.create', { titolo: 'Da archiviare', data: isoDay(4) }, t).data;
  assert.equal(call(env.ctx, 'eventi.stato', { id: e.id, stato: 'boh' }, t).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'eventi.stato', { id: e.id, stato: 'archiviato' }, t).ok, true);
  assert.equal(call(env.ctx, 'eventi.list', {}, t).data.some(x => x.id === e.id), false);
  assert.equal(call(env.ctx, 'eventi.list', { archiviati: true }, t).data.some(x => x.id === e.id), true);
});

test('sync Calendar: crea, gestisce più giorni, tutto il giorno, colori, descrizione HTML, ricorrenze', () => {
  const d1 = isoDay(3), d2 = isoDay(5), d3 = isoDay(8);
  const events = [
    { id: 'a@google.com', title: 'Cantelmo: Concerto', start: romeTime(d1, '21:00'), end: romeTime(d1, '23:30'), location: 'Officine Cantelmo', description: 'Contatto <b>Mario</b><br>393 000', color: '6' },
    { id: 'b@google.com', title: 'Convegno', allDay: true, start: d2, end: isoDay(8), description: '' },
    { id: 'c@google.com', title: 'Notte', start: romeTime(d1, '23:00'), end: romeTime(isoDay(4), '02:00') },
    { id: 'r@google.com', title: 'Prova ricorrente', recurring: true, start: romeTime(d3, '10:00'), end: romeTime(d3, '11:00') },
    { id: 'r@google.com', title: 'Prova ricorrente', recurring: true, start: romeTime(isoDay(15), '10:00'), end: romeTime(isoDay(15), '11:00') }
  ];
  const env = boot(events);
  const t = login(env);
  const list = call(env.ctx, 'eventi.list', {}, t).data;
  assert.equal(list.length, 5);
  const conc = list.find(e => e.titolo === 'Cantelmo: Concerto');
  assert.equal(conc.data, d1);
  assert.equal(conc.ora_inizio, '21:00');
  assert.equal(conc.ora_fine, '23:30');
  assert.equal(conc.colore, '#f4511e');
  assert.equal(conc.descrizione, 'Contatto Mario\n393 000');
  assert.equal(conc.origine, 'calendar');
  const conv = list.find(e => e.titolo === 'Convegno');
  assert.equal(conv.data, d2);
  assert.equal(conv.data_fine, isoDay(7), 'fine esclusiva del Calendar convertita in ultimo giorno');
  assert.equal(conv.ora_inizio, '');
  assert.equal(conv.colore, '#9fc6e7', 'senza colore proprio usa quello del calendario');
  const notte = list.find(e => e.titolo === 'Notte');
  assert.equal(notte.data_fine, isoDay(4));
  assert.equal(list.filter(e => e.titolo === 'Prova ricorrente').length, 2, 'ogni occorrenza è un evento');
  assert.ok(list.every(e => e.stato_doc.piano === false));
});

test('sync Calendar: aggiorna, annulla, riattiva, non tocca manuali e archiviati, nessun duplicato', () => {
  const d1 = isoDay(3);
  const events = [
    { id: 'a@google.com', title: 'Uno', start: romeTime(d1, '21:00'), end: romeTime(d1, '22:00') },
    { id: 'b@google.com', title: 'Due', allDay: true, start: isoDay(6), end: isoDay(7) },
    { id: 'c@google.com', title: 'Tre', allDay: true, start: isoDay(9), end: isoDay(10) }
  ];
  const env = boot(events);
  const t = login(env);
  const manual = call(env.ctx, 'eventi.create', { titolo: 'Manuale', data: isoDay(2) }, t).data;
  const tre = call(env.ctx, 'eventi.list', {}, t).data.find(e => e.titolo === 'Tre');
  call(env.ctx, 'eventi.stato', { id: tre.id, stato: 'archiviato' }, t);

  env.state.calendar.events = [
    { id: 'a@google.com', title: 'Uno spostato', start: romeTime(isoDay(4), '20:00'), end: romeTime(isoDay(4), '22:00') }
  ];
  let r = call(env.ctx, 'sync.run', {}, t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ c: r.data.creati, a: r.data.aggiornati, x: r.data.annullati }, { c: 0, a: 1, x: 1 });
  let all = call(env.ctx, 'eventi.list', { archiviati: true }, t).data;
  assert.equal(all.find(e => e.titolo === 'Uno spostato').data, isoDay(4));
  assert.equal(all.find(e => e.titolo === 'Due').stato, 'annullato');
  assert.equal(all.find(e => e.titolo === 'Tre').stato, 'archiviato', 'gli archiviati restano tali');
  assert.equal(all.find(e => e.id === manual.id).stato, 'attivo', 'i manuali non vengono toccati');

  env.state.calendar.events.push({ id: 'b@google.com', title: 'Due', allDay: true, start: isoDay(6), end: isoDay(7) });
  r = call(env.ctx, 'sync.run', {}, t);
  assert.equal(r.data.riattivati, 1);
  r = call(env.ctx, 'sync.run', {}, t);
  assert.deepEqual({ c: r.data.creati, a: r.data.aggiornati, x: r.data.annullati, ri: r.data.riattivati }, { c: 0, a: 0, x: 0, ri: 0 }, 'seconda sync senza cambi non scrive');
  all = call(env.ctx, 'eventi.list', { archiviati: true }, t).data;
  assert.equal(all.length, 4);
  const imp = call(env.ctx, 'impostazioni.get', {}, t).data;
  assert.ok(imp.sync.ultimo);
});

test('sync Calendar: non permette di modificare i campi di un evento importato', () => {
  const env = boot([{ id: 'a@google.com', title: 'Da Calendar', allDay: true, start: isoDay(3), end: isoDay(4) }]);
  const t = login(env);
  const e = call(env.ctx, 'eventi.list', {}, t).data[0];
  assert.equal(call(env.ctx, 'eventi.update', { id: e.id, titolo: 'Altro' }, t).error.code, 'INVALID');
  const n = call(env.ctx, 'eventi.update', { id: e.id, versione: e.versione, note: 'Carico alle 15' }, t);
  assert.equal(n.ok, true);
  assert.equal(n.data.note, 'Carico alle 15');
});

test('impostazioni: liste modificabili dall\'admin, pulite e senza duplicati', () => {
  const env = boot();
  const t = login(env);
  let s = call(env.ctx, 'impostazioni.get', {}, t).data;
  assert.deepEqual(s.liste.provenienze, ['CoolClub', 'Da noleggiare', 'Fornito da terzi', 'Da altro magazzino', 'Da verificare']);
  const r = call(env.ctx, 'impostazioni.lista', { lista: 'aree', valori: ['Audio', ' audio ', 'Luci', '', 'Scenografia'] }, t);
  assert.deepEqual(r.data.valori, ['Audio', 'Luci', 'Scenografia']);
  assert.equal(call(env.ctx, 'impostazioni.lista', { lista: 'aree', valori: [] }, t).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'impostazioni.lista', { lista: 'boh', valori: ['a'] }, t).error.code, 'INVALID');
  s = call(env.ctx, 'impostazioni.get', {}, t).data;
  assert.deepEqual(s.liste.aree, ['Audio', 'Luci', 'Scenografia']);
});

test('backup settimanale: copia il database e ne tiene al massimo 8', () => {
  const env = boot();
  for (let i = 0; i < 10; i++) {
    const realFmt = env.ctx.Utilities.formatDate;
    env.ctx.Utilities.formatDate = (d, tz, p) => p === 'yyyy-MM-dd HH.mm' ? `2026-11-${String(10 + i).padStart(2, '0')} 04.00` : realFmt(d, tz, p);
    env.ctx.backupSettimanale();
    env.ctx.Utilities.formatDate = realFmt;
  }
  const files = env.state.drive.folders.get(env.state.props.BACKUP_ID);
  assert.equal(files.filter(f => !f.trashed).length, 8);
});

test('errore interno: messaggio generico, nessun dettaglio esposto', () => {
  const env = boot();
  const t = login(env);
  env.ctx.Events.list = () => { throw new Error('dettaglio segreto'); };
  const r = call(env.ctx, 'eventi.list', {}, t);
  assert.equal(r.error.code, 'SERVER');
  assert.ok(!r.error.message.includes('segreto'));
});

test('simulatore: senza formato testo un id numerico verrebbe convertito (controllo del test)', async () => {
  const { createGoogle } = await import('../mocks/google.mjs');
  const { google } = createGoogle();
  const sh = google.SpreadsheetApp.openById('x').insertSheet('t');
  sh.getRange(1, 1, 1, 2).setValues([['1980e060', '0123']]);
  assert.equal(typeof sh.rows()[0][1], 'number', 'senza "@" il foglio converte');
  sh.getRange(2, 1, 1, 1).setNumberFormat('@');
  sh.getRange(2, 1, 1, 1).setValues([['0123']]);
  assert.equal(sh.rows()[1][0], '0123');
});

test('il file unico Codice.gs (quello da incollare) funziona come i sorgenti', async () => {
  const { loadBackend: lb } = await import('../mocks/google.mjs');
  const env = lb({ adminEmail: ADMIN, dist: true, calendarEvents: [{ id: 'a@google.com', title: 'Uno', allDay: true, start: isoDay(2), end: isoDay(3) }] });
  env.ctx.setupProduzione();
  const t = login(env);
  const r = call(env.ctx, 'eventi.list', {}, t);
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 1);
  assert.equal(env.ctx.doGet().getContent().includes('CTRL API'), true);
});
