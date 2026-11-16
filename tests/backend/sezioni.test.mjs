/**
 * Fase 2: piano di produzione, lista materiale, scheda tecnica, allegati su Drive.
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

test('dettaglio evento: tre sezioni vuote con versione 0', () => {
  const env = boot();
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, env.token));
  for (const s of ['piano', 'materiale', 'scheda']) {
    assert.deepEqual(ev.sezioni[s], { righe: [], testo: '', versione: '0', allegati: [] });
  }
});

test('piano: righe salvate, ordinate, modificate, tolte; indicatore acceso e spento', () => {
  const env = boot();
  let s = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'piano', versione: '0', righe: [
    { ora_inizio: '15:00', ora_fine: '17:00', attivita: 'Carico e montaggio', responsabile: 'Manuel' },
    { ora_inizio: '', ora_fine: '', attivita: '', responsabile: '', note: '' }, // riga vuota: ignorata
    { ora_inizio: '18:00', attivita: 'Soundcheck', note: 'Palco A' }
  ] }, env.token));
  assert.equal(s.righe.length, 2);
  assert.equal(s.versione, '1');
  assert.deepEqual(s.righe.map(r => r.attivita), ['Carico e montaggio', 'Soundcheck']);
  assert.equal(ok(call(env.ctx, 'eventi.list', {}, env.token))[0].stato_doc.piano, true);

  // riordina, modifica la prima, toglie la seconda, aggiunge una nuova
  const [carico, sound] = s.righe;
  s = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'piano', versione: s.versione, righe: [
    { ...sound, ora_inizio: '18:30' },
    { attivita: 'Show', ora_inizio: '21:00', ora_fine: '23:00' }
  ] }, env.token));
  assert.deepEqual(s.righe.map(r => [r.attivita, r.ora_inizio]), [['Soundcheck', '18:30'], ['Show', '21:00']]);
  assert.equal(s.righe[0].id, sound.id, 'la riga esistente mantiene il suo id');
  const tolta = rows(env, 'attivita').find(r => r[0] === carico.id);
  assert.equal(tolta[8], 'TRUE', 'la riga tolta resta nel foglio come eliminata');

  s = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'piano', versione: s.versione, righe: [] }, env.token));
  assert.equal(s.righe.length, 0);
  assert.equal(ok(call(env.ctx, 'eventi.list', {}, env.token))[0].stato_doc.piano, false);
  const log = rows(env, 'storico').filter(r => r[3] === 'piano');
  assert.equal(log.length, 3);
});

test('validazione delle righe: campo obbligatorio, orari, sezione sconosciuta, troppe righe', () => {
  const env = boot();
  const base = { evento_id: env.ev.id, versione: '0' };
  let r = call(env.ctx, 'sezioni.righe', { ...base, sezione: 'materiale', righe: [{ quantita: '2' }] }, env.token);
  assert.equal(r.error.code, 'INVALID');
  assert.match(r.error.message, /Riga 1.*voce/);
  r = call(env.ctx, 'sezioni.righe', { ...base, sezione: 'piano', righe: [{ attivita: 'X', ora_inizio: '25:00' }] }, env.token);
  assert.match(r.error.message, /orario non valido/);
  r = call(env.ctx, 'sezioni.righe', { ...base, sezione: 'cucina', righe: [] }, env.token);
  assert.equal(r.error.code, 'INVALID');
  r = call(env.ctx, 'sezioni.righe', { ...base, sezione: 'scheda', righe: Array.from({ length: 301 }, (_, i) => ({ sorgente: 'Ch ' + i })) }, env.token);
  assert.match(r.error.message, /Massimo 300/);
  r = call(env.ctx, 'sezioni.righe', { evento_id: 'ev_inesistente', sezione: 'piano', versione: '0', righe: [] }, env.token);
  assert.equal(r.error.code, 'NOT_FOUND');
  // nulla è stato scritto
  assert.equal(rows(env, 'materiale').length, 1);
  assert.equal(rows(env, 'testi').length, 1);
});

test('materiale e scheda: campi completi, testo e id restano testo, quantità non diventa numero', () => {
  const env = boot();
  const m = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'materiale', versione: '0', righe: [
    { voce: 'Mixer Yamaha QL5', quantita: '1', area: 'Audio', provenienza: 'CoolClub', note: 'con stagebox' },
    { voce: 'Cavo XLR 10 m', quantita: '24', area: 'Audio', provenienza: 'Da noleggiare' }
  ] }, env.token));
  assert.deepEqual(m.righe[1], { id: m.righe[1].id, voce: 'Cavo XLR 10 m', quantita: '24', area: 'Audio', provenienza: 'Da noleggiare', note: '' });
  assert.equal(typeof rows(env, 'materiale')[2][3], 'string', 'quantità salvata come testo');
  const c = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'scheda', versione: '0', righe: [
    { numero: '1', sorgente: 'Kick in', microfono: 'Beta 91', asta: '' },
    { numero: '2', sorgente: 'Basso', di: 'DI attiva' }
  ] }, env.token));
  assert.deepEqual(c.righe.map(r => r.numero), ['1', '2']);
  const ev = ok(call(env.ctx, 'eventi.list', {}, env.token))[0];
  assert.deepEqual(ev.stato_doc, { piano: false, materiale: true, scheda: true });
});

test('testo libero: salvato, accende l\'indicatore, storico; svuotato lo spegne', () => {
  const env = boot();
  let s = ok(call(env.ctx, 'sezioni.testo', { evento_id: env.ev.id, sezione: 'scheda', versione: '0', testo: 'Channel list nel rider allegato.\nPalco 8x6.' }, env.token));
  assert.equal(s.testo, 'Channel list nel rider allegato.\nPalco 8x6.');
  assert.equal(s.versione, '1');
  assert.equal(ok(call(env.ctx, 'eventi.list', {}, env.token))[0].stato_doc.scheda, true);
  s = ok(call(env.ctx, 'sezioni.testo', { evento_id: env.ev.id, sezione: 'scheda', versione: s.versione, testo: '' }, env.token));
  assert.equal(ok(call(env.ctx, 'eventi.list', {}, env.token))[0].stato_doc.scheda, false);
  const r = call(env.ctx, 'sezioni.testo', { evento_id: env.ev.id, sezione: 'scheda', versione: s.versione, testo: 'x'.repeat(20001) }, env.token);
  assert.match(r.error.message, /troppo lungo/);
});

test('conflitto: due persone sulla stessa sezione non si sovrascrivono', () => {
  const env = boot();
  const t2 = utente(env, 'manuel@example.com', 'COLLABORATORE', { puo_modificare: true });
  const a = ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'materiale', versione: '0', righe: [{ voce: 'Casse' }] }, env.token));
  // Manuel aveva aperto la sezione quando era alla versione 0
  const r = call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'materiale', versione: '0', righe: [{ voce: 'Luci' }] }, t2);
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.attuale.versione, a.versione);
  // anche il testo usa la stessa versione della sezione
  assert.equal(call(env.ctx, 'sezioni.testo', { evento_id: env.ev.id, sezione: 'materiale', versione: '0', testo: 'x' }, t2).error.code, 'CONFLICT');
  // altre sezioni non sono bloccate
  ok(call(env.ctx, 'sezioni.righe', { evento_id: env.ev.id, sezione: 'piano', versione: '0', righe: [{ attivita: 'Carico' }] }, t2));
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, env.token));
  assert.deepEqual(ev.sezioni.materiale.righe.map(r => r.voce), ['Casse']);
});

test('permessi: lettura e collaboratore senza permessi non modificano né caricano', () => {
  const env = boot();
  const lett = utente(env, 'tecnico@example.com', 'LETTURA');
  const coll = utente(env, 'collab@example.com', 'COLLABORATORE', { puo_caricare: true, puo_modificare: false });
  const righe = { evento_id: env.ev.id, sezione: 'piano', versione: '0', righe: [{ attivita: 'X' }] };
  assert.equal(call(env.ctx, 'sezioni.righe', righe, lett).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'sezioni.righe', righe, coll).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'sezioni.testo', { ...righe, testo: 'x' }, lett).error.code, 'FORBIDDEN');
  const file = { evento_id: env.ev.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: b64('%PDF-1.4 test') };
  assert.equal(call(env.ctx, 'allegati.carica', file, lett).error.code, 'FORBIDDEN');
  ok(call(env.ctx, 'allegati.carica', file, coll), 'il collaboratore con "può caricare" carica');
  // la lettura vede e scarica
  const ev = ok(call(env.ctx, 'eventi.get', { id: env.ev.id }, lett));
  assert.equal(ev.sezioni.scheda.allegati.length, 1);
  const d = ok(call(env.ctx, 'allegati.scarica', { id: ev.sezioni.scheda.allegati[0].id }, lett));
  assert.equal(Buffer.from(d.dati, 'base64').toString(), '%PDF-1.4 test');
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
  const al = ev.sezioni.piano.allegati[0];
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
  const c1 = utente(env, 'c1@example.com', 'COLLABORATORE', { puo_caricare: true });
  const c2 = utente(env, 'c2@example.com', 'COLLABORATORE', { puo_caricare: true });
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
