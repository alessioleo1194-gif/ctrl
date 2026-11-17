/**
 * Fase 2 · accessi: scadenza per utente, richieste di accesso, registro accessi, sessioni e disconnessione remota.
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

function boot() {
  const env = loadBackend({ adminEmail: ADMIN });
  env.ctx.setupProduzione();
  env.token = login(env);
  return env;
}

function codeFor(env, email) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  return env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
}

function loginRes(env, email = ADMIN, dispositivo = 'Mozilla/5.0 (iPhone) Safari') {
  return call(env.ctx, 'auth.verifyCode', { email, code: codeFor(env, email), dispositivo });
}

function login(env, email = ADMIN, dispositivo) {
  const r = loginRes(env, email, dispositivo);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.token;
}

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const rows = (env, name) => env.getSS(DB).getSheetByName(name).rows();
const utenti = (env) => ok(call(env.ctx, 'utenti.list', {}, env.token));
const logAccessi = (env, p = {}) => ok(call(env.ctx, 'accessi.list', p, env.token)).righe;
const salva = (env, u) => call(env.ctx, 'utenti.save', { nome: u.email, ruolo: 'VIEWER', ...u }, env.token);

test('scadenza: l\'accesso vale fino alla fine del giorno indicato, poi login rifiutato e sessioni inutilizzabili', () => {
  const env = boot();
  ok(salva(env, { email: 'oggi@example.com', scade_il: isoDay(0) }));
  ok(salva(env, { email: 'ieri@example.com', scade_il: isoDay(-1) }));
  ok(salva(env, { email: 'senza@example.com' }));

  login(env, 'oggi@example.com');
  login(env, 'senza@example.com');
  const r = loginRes(env, 'ieri@example.com');
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /scaduto/i);
  assert.equal(logAccessi(env, { filtro: 'problemi' })[0].evento, 'accesso_scaduto');

  // una sessione già aperta smette di valere quando la scadenza passa
  const t = login(env, 'oggi@example.com');
  assert.equal(call(env.ctx, 'auth.me', {}, t).ok, true);
  ok(salva(env, { email: 'oggi@example.com', scade_il: isoDay(-1) }));
  assert.equal(call(env.ctx, 'auth.me', {}, t).error.code, 'AUTH_REQUIRED');

  const l = utenti(env);
  const by = (e) => l.find(u => u.email === e);
  assert.equal(by('ieri@example.com').scaduto, true);
  assert.equal(by('ieri@example.com').giorni_rimasti, null);
  assert.equal(by('senza@example.com').scaduto, false);
  assert.equal(by('senza@example.com').scade_il, '');
});

test('scadenza: giorni rimasti, data non valida, il proprietario non scade, data a mano nel foglio sbagliata = scaduto', () => {
  const env = boot();
  ok(salva(env, { email: 'tra3@example.com', scade_il: isoDay(3) }));
  assert.equal(utenti(env).find(u => u.email === 'tra3@example.com').giorni_rimasti, 3);
  assert.equal(salva(env, { email: 'x@example.com', scade_il: '31/12/2026' }).error.code, 'INVALID');
  assert.equal(salva(env, { email: 'x@example.com', scade_il: '2026-02-30' }).error.code, 'INVALID');
  assert.equal(salva(env, { email: ADMIN, ruolo: 'OWNER', scade_il: isoDay(5) }).error.code, 'INVALID');
  assert.equal(utenti(env).find(u => u.email === ADMIN).scade_il, '');

  // modifica a mano del foglio con un valore che non è una data: fallisce chiuso
  const sh = env.getSS(DB).getSheetByName('utenti');
  const col = sh.rows()[0].indexOf('scade_il');
  const r = sh.rows().findIndex(x => x[1] === 'tra3@example.com');
  sh.rows()[r][col] = 'domani';
  assert.equal(utenti(env).find(u => u.email === 'tra3@example.com').scaduto, true);
  assert.equal(loginRes(env, 'tra3@example.com').error.code, 'FORBIDDEN');

  // il proprietario resta dentro anche con una data scritta a mano
  sh.rows().find(x => x[1] === ADMIN)[col] = '2000-01-01';
  assert.equal(loginRes(env, ADMIN).ok, true);
});

test('scadenza: toglierla riattiva; senza campo nella richiesta la scadenza resta com\'è', () => {
  const env = boot();
  ok(salva(env, { email: 'a@example.com', scade_il: isoDay(-2) }));
  assert.equal(loginRes(env, 'a@example.com').error.code, 'FORBIDDEN');
  const v = utenti(env).find(u => u.email === 'a@example.com').versione;
  ok(salva(env, { email: 'a@example.com', versione: v, scade_il: '' }));
  assert.equal(loginRes(env, 'a@example.com').ok, true);
  ok(salva(env, { email: 'b@example.com', scade_il: isoDay(9) }));
  ok(salva(env, { email: 'b@example.com', nome: 'B nuovo' }));
  assert.equal(utenti(env).find(u => u.email === 'b@example.com').scade_il, isoDay(9));
});

test('proroga: da oggi se scaduto, dalla data attuale se futura; solo 7 o 30 giorni; solo con scadenza; solo owner', () => {
  const env = boot();
  ok(salva(env, { email: 'fut@example.com', scade_il: isoDay(5) }));
  ok(salva(env, { email: 'sca@example.com', scade_il: isoDay(-10) }));
  ok(salva(env, { email: 'inf@example.com' }));
  assert.equal(ok(call(env.ctx, 'utenti.proroga', { email: 'fut@example.com', giorni: 30 }, env.token)).scade_il, isoDay(35));
  assert.equal(ok(call(env.ctx, 'utenti.proroga', { email: 'sca@example.com', giorni: 7 }, env.token)).scade_il, isoDay(7));
  assert.equal(loginRes(env, 'sca@example.com').ok, true, 'dopo la proroga entra');
  assert.equal(call(env.ctx, 'utenti.proroga', { email: 'fut@example.com', giorni: 5 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.proroga', { email: 'inf@example.com', giorni: 30 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.proroga', { email: ADMIN, giorni: 30 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.proroga', { email: 'nessuno@example.com', giorni: 30 }, env.token).error.code, 'NOT_FOUND');
  ok(salva(env, { email: 'prod@example.com', ruolo: 'PRODUCTION' }));
  const tp = login(env, 'prod@example.com');
  assert.equal(call(env.ctx, 'utenti.proroga', { email: 'fut@example.com', giorni: 30 }, tp).error.code, 'FORBIDDEN');
  assert.ok(logAccessi(env, { filtro: 'amministrazione' }).some(r => r.evento === 'scadenza' && r.email === 'sca@example.com'));
});

test('pulizia notturna: chiude le sessioni di chi è scaduto (una sola riga di log) e cancella il registro oltre 180 giorni', () => {
  const env = boot();
  ok(salva(env, { email: 'ex@example.com', scade_il: isoDay(5) }));
  login(env, 'ex@example.com'); login(env, 'ex@example.com');
  // la scadenza passa "dietro le quinte": scritta a mano nel foglio
  const sh = env.getSS(DB).getSheetByName('utenti');
  const col = sh.rows()[0].indexOf('scade_il');
  sh.rows().find(x => x[1] === 'ex@example.com')[col] = isoDay(-1);
  const sessioniPrima = rows(env, 'sessioni').filter(x => x[1] === 'ex@example.com').length;
  assert.equal(sessioniPrima, 2);
  // riga di registro vecchia
  env.ctx.Db.clearCache();
  env.ctx.Db.insert('accessi', { ts: '2020-01-01T10:00:00', email: 'vecchio@example.com', evento: 'login', esito: 'ok' });
  const r = JSON.parse(JSON.stringify(env.ctx.puliziaNotturna()));
  assert.equal(r.scaduti, 2);
  assert.equal(r.registro.accessi, 1);
  assert.equal(rows(env, 'sessioni').filter(x => x[1] === 'ex@example.com').length, 0);
  const chiusure = logAccessi(env).filter(x => x.evento === 'accesso_scaduto' && x.email === 'ex@example.com');
  assert.equal(chiusure.length, 1);
  assert.equal(logAccessi(env).some(x => x.email === 'vecchio@example.com'), false);
  // seconda notte: niente da chiudere, nessuna riga in più
  env.ctx.puliziaNotturna();
  assert.equal(logAccessi(env).filter(x => x.evento === 'accesso_scaduto' && x.email === 'ex@example.com').length, 1);
});

test('registro accessi: login, logout, codici errati; niente codici né token; email sconosciute non lasciano tracce; solo owner', () => {
  const env = boot();
  ok(salva(env, { email: 'tec@example.com', ruolo: 'PRODUCTION' }));
  const t = login(env, 'tec@example.com', 'Mozilla/5.0 (Windows) Chrome');
  call(env.ctx, 'auth.logout', {}, t);

  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email: 'tec@example.com' });
  const giusto = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  const sbagliato = giusto === '111111' ? '222222' : '111111';
  call(env.ctx, 'auth.verifyCode', { email: 'tec@example.com', code: sbagliato, dispositivo: 'Telefono' });

  call(env.ctx, 'auth.requestCode', { email: 'sconosciuto@example.com' });
  call(env.ctx, 'auth.verifyCode', { email: 'sconosciuto@example.com', code: '123456' });

  const all = logAccessi(env);
  const mie = all.filter(r => r.email === 'tec@example.com').map(r => r.evento).reverse();
  assert.deepEqual(mie, ['utente_creato', 'login', 'logout', 'codice_errato']);
  assert.equal(all.find(r => r.evento === 'login').dispositivo, 'Mozilla/5.0 (Windows) Chrome');
  assert.equal(all.some(r => r.email === 'sconosciuto@example.com'), false, 'nessuna traccia di email sconosciute');
  const testo = JSON.stringify(rows(env, 'accessi'));
  assert.ok(!testo.includes(giusto) && !testo.includes(t), 'né codice né token nel registro');

  assert.deepEqual(logAccessi(env, { filtro: 'accessi' }).map(r => r.evento).sort(), ['login', 'login', 'logout']);
  assert.deepEqual(logAccessi(env, { filtro: 'problemi' }).map(r => r.evento), ['codice_errato']);
  assert.ok(logAccessi(env, { q: 'TEC@' }).every(r => r.email === 'tec@example.com'));
  assert.equal(logAccessi(env, { limite: 2 }).length, 2);
  assert.equal(ok(call(env.ctx, 'accessi.list', {}, env.token)).conserva_giorni, 180);

  const tp = login(env, 'tec@example.com');
  assert.equal(call(env.ctx, 'accessi.list', {}, tp).error.code, 'FORBIDDEN');
});

test('registro accessi: cinque codici errati, accesso disattivato, cambi di ruolo e stato registrati con chi li ha fatti', () => {
  const env = boot();
  ok(salva(env, { email: 'x@example.com', ruolo: 'VIEWER' }));
  call(env.ctx, 'auth.requestCode', { email: 'x@example.com' });
  for (let i = 0; i < 5; i++) call(env.ctx, 'auth.verifyCode', { email: 'x@example.com', code: '000000' });
  assert.deepEqual(logAccessi(env, { filtro: 'problemi' }).map(r => r.evento).reverse(),
    ['codice_errato', 'codice_errato', 'codice_errato', 'codice_errato', 'codici_esauriti']);

  const v = () => utenti(env).find(u => u.email === 'x@example.com').versione;
  ok(salva(env, { email: 'x@example.com', ruolo: 'PRODUCTION', versione: v() }));
  ok(salva(env, { email: 'x@example.com', ruolo: 'PRODUCTION', attivo: false, versione: v() }));
  ok(salva(env, { email: 'x@example.com', ruolo: 'PRODUCTION', attivo: true, versione: v() }));
  const amm = logAccessi(env, { filtro: 'amministrazione' }).filter(r => r.email === 'x@example.com').map(r => [r.evento, r.attore, r.dettaglio]).reverse();
  assert.deepEqual(amm, [
    ['utente_creato', ADMIN, 'Viewer'],
    ['ruolo', ADMIN, 'Viewer → Production'],
    ['disattivato', ADMIN, ''],
    ['riattivato', ADMIN, '']
  ]);
});

test('sessioni: elenco senza dati segreti, disconnessione di un dispositivo o di tutti, solo owner', () => {
  const env = boot();
  ok(salva(env, { email: 'tec@example.com', ruolo: 'PRODUCTION' }));
  const a = login(env, 'tec@example.com', 'iPhone Safari');
  const b = login(env, 'tec@example.com', 'Windows Chrome');
  const lista = ok(call(env.ctx, 'utenti.sessioni', { email: 'tec@example.com' }, env.token));
  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(s => s.dispositivo).sort(), ['Windows Chrome', 'iPhone Safari']);
  assert.ok(lista.every(s => s.id.length === 16 && !JSON.stringify(s).includes(a) && !JSON.stringify(s).includes(b)));
  assert.equal(utenti(env).find(u => u.email === 'tec@example.com').sessioni, 2);

  assert.equal(call(env.ctx, 'utenti.disconnetti', { email: 'tec@example.com', id: 'abc' }, env.token).error.code, 'INVALID');
  const iphone = lista.find(s => s.dispositivo === 'iPhone Safari');
  assert.equal(ok(call(env.ctx, 'utenti.disconnetti', { email: 'tec@example.com', id: iphone.id }, env.token)).chiuse, 1);
  assert.equal(call(env.ctx, 'auth.me', {}, a).error.code, 'AUTH_REQUIRED');
  assert.equal(call(env.ctx, 'auth.me', {}, b).ok, true);
  // un id di un altro utente non chiude nulla
  const altro = ok(call(env.ctx, 'utenti.sessioni', { email: ADMIN }, env.token))[0];
  assert.equal(ok(call(env.ctx, 'utenti.disconnetti', { email: 'tec@example.com', id: altro.id }, env.token)).chiuse, 0);

  assert.equal(call(env.ctx, 'utenti.sessioni', { email: ADMIN }, b).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'utenti.disconnetti', { email: ADMIN }, b).error.code, 'FORBIDDEN');
  assert.equal(ok(call(env.ctx, 'utenti.disconnetti', { email: 'tec@example.com' }, env.token)).chiuse, 1);
  assert.equal(call(env.ctx, 'auth.me', {}, b).error.code, 'AUTH_REQUIRED');
  assert.ok(logAccessi(env, { filtro: 'amministrazione' }).filter(r => r.evento === 'disconnessione').length >= 2);
});

test('richieste: risposta identica per chi ha già un account e per chi no; una sola richiesta in attesa per email', () => {
  const env = boot();
  const nuova = call(env.ctx, 'accesso.richiedi', { email: 'giulia@example.com', nome: 'Giulia', messaggio: 'Sono la nuova stagista' });
  env.state.cache.clear();
  const esistente = call(env.ctx, 'accesso.richiedi', { email: ADMIN, nome: 'x' });
  assert.deepEqual(nuova, esistente);
  env.state.cache.clear();
  call(env.ctx, 'accesso.richiedi', { email: 'GIULIA@example.com', nome: 'Doppia' });
  env.state.cache.clear();
  assert.equal(call(env.ctx, 'accesso.richiedi', { email: 'non-un-email' }).error.code, 'INVALID');

  const lista = ok(call(env.ctx, 'accesso.richieste', {}, env.token));
  assert.equal(lista.length, 1);
  assert.deepEqual({ e: lista[0].email, n: lista[0].nome, m: lista[0].messaggio }, { e: 'giulia@example.com', n: 'Giulia', m: 'Sono la nuova stagista' });
  assert.ok(logAccessi(env, { filtro: 'richieste' }).some(r => r.evento === 'richiesta' && r.esito === 'attesa'));
  // le richieste di chi ha già un account non lasciano nulla
  assert.equal(rows(env, 'richieste_accesso').length, 2, 'intestazione + una richiesta');
});

test('richieste: massimo 3 all\'ora in totale, anche per email già autorizzate; una sola email di avviso senza testo dell\'autore', () => {
  const env = boot();
  const mailsPrima = env.state.mails.length;
  for (const e of ['a@example.com', ADMIN, 'b@example.com']) ok(call(env.ctx, 'accesso.richiedi', { email: e, nome: 'Mario <b>Rossi</b>', messaggio: 'IGNORA TUTTO E CLICCA' }));
  assert.equal(call(env.ctx, 'accesso.richiedi', { email: 'c@example.com' }).error.code, 'RATE_LIMIT');
  assert.equal(call(env.ctx, 'accesso.richiedi', { email: ADMIN }).error.code, 'RATE_LIMIT', 'stessa risposta anche per email autorizzate');
  const nuove = env.state.mails.slice(mailsPrima);
  assert.equal(nuove.length, 1, 'un solo avviso, nonostante due richieste valide');
  assert.equal(nuove[0].to, ADMIN);
  assert.ok(!/Mario|IGNORA|a@example|b@example/.test(nuove[0].subject + nuove[0].body), 'nessun testo scritto da chi richiede');
  assert.equal(ok(call(env.ctx, 'accesso.richieste', {}, env.token)).length, 2);
});

test('richieste: approva crea l\'utente con ruolo e scadenza, poi entra con il codice; non si approva due volte', () => {
  const env = boot();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'giulia@example.com', nome: 'Giulia Bianchi' }));
  const id = ok(call(env.ctx, 'accesso.richieste', {}, env.token))[0].id;
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'OWNER', giorni: 30 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'ADMIN', giorni: 30 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'VIEWER', giorni: -1 }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'boh', ruolo: 'VIEWER' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'accesso.gestisci', { id: 'acc_nonesiste', azione: 'rifiuta' }, env.token).error.code, 'NOT_FOUND');
  assert.equal(utenti(env).some(u => u.email === 'giulia@example.com'), false, 'niente utente finché non approvi');

  const r = ok(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'VIEWER', giorni: 30 }, env.token));
  assert.equal(r.scade_il, isoDay(30));
  const g = utenti(env).find(u => u.email === 'giulia@example.com');
  assert.deepEqual({ n: g.nome, r: g.ruolo, a: g.attivo, s: g.scade_il }, { n: 'Giulia Bianchi', r: 'VIEWER', a: true, s: isoDay(30) });
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'VIEWER', giorni: 30 }, env.token).error.code, 'CONFLICT');
  assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'rifiuta' }, env.token).error.code, 'CONFLICT');
  assert.equal(ok(call(env.ctx, 'accesso.richieste', {}, env.token)).length, 0);
  assert.equal(loginRes(env, 'giulia@example.com').ok, true);
  const ev = logAccessi(env, { filtro: 'richieste' }).map(x => x.evento);
  assert.ok(ev.includes('richiesta') && ev.includes('richiesta_approvata'));
});

test('richieste: senza durata = nessuna scadenza; il nome mancante diventa la parte prima della chiocciola', () => {
  const env = boot();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'anonimo.x@example.com' }));
  const id = ok(call(env.ctx, 'accesso.richieste', {}, env.token))[0].id;
  ok(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'PRODUCTION' }, env.token));
  const u = utenti(env).find(x => x.email === 'anonimo.x@example.com');
  assert.deepEqual({ n: u.nome, r: u.ruolo, s: u.scade_il }, { n: 'anonimo.x', r: 'PRODUCTION', s: '' });
});

test('richieste: rifiuta chiude la richiesta e per 7 giorni non se ne accettano altre della stessa email', () => {
  const env = boot();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'no@example.com', nome: 'No' }));
  const id = ok(call(env.ctx, 'accesso.richieste', {}, env.token))[0].id;
  ok(call(env.ctx, 'accesso.gestisci', { id, azione: 'rifiuta' }, env.token));
  assert.equal(utenti(env).some(u => u.email === 'no@example.com'), false);
  env.state.cache.clear();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'no@example.com', nome: 'Riprovo' }));
  assert.equal(ok(call(env.ctx, 'accesso.richieste', {}, env.token)).length, 0, 'bloccata per 7 giorni');
  assert.equal(rows(env, 'richieste_accesso').length, 2, 'intestazione + la richiesta rifiutata');
  assert.ok(logAccessi(env, { filtro: 'richieste' }).some(r => r.evento === 'richiesta_rifiutata' && r.attore === ADMIN));
  // rifiutata = nessun account: nemmeno un codice a caso apre una sessione
  assert.equal(call(env.ctx, 'auth.verifyCode', { email: 'no@example.com', code: '123456' }).ok, false);
});

test('richieste: solo l\'owner le vede e le gestisce', () => {
  const env = boot();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'x@example.com' }));
  const id = ok(call(env.ctx, 'accesso.richieste', {}, env.token))[0].id;
  ok(salva(env, { email: 'prod@example.com', ruolo: 'PRODUCTION' }));
  ok(salva(env, { email: 'view@example.com', ruolo: 'VIEWER' }));
  for (const mail of ['prod@example.com', 'view@example.com']) {
    const t = login(env, mail);
    assert.equal(call(env.ctx, 'accesso.richieste', {}, t).error.code, 'FORBIDDEN');
    assert.equal(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'VIEWER' }, t).error.code, 'FORBIDDEN');
  }
  assert.equal(call(env.ctx, 'accesso.richieste', {}).error.code, 'AUTH_REQUIRED');
});

test('richieste: chi è stato approvato e poi scade vede "Accesso scaduto", non un errore generico', () => {
  const env = boot();
  ok(call(env.ctx, 'accesso.richiedi', { email: 'tmp@example.com', nome: 'Tmp' }));
  const id = ok(call(env.ctx, 'accesso.richieste', {}, env.token))[0].id;
  ok(call(env.ctx, 'accesso.gestisci', { id, azione: 'approva', ruolo: 'VIEWER', giorni: 7 }, env.token));
  ok(salva(env, { email: 'tmp@example.com', scade_il: isoDay(-1) }));
  const r = loginRes(env, 'tmp@example.com');
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /Accesso scaduto/);
});

test('migrazione: il setup su un foglio della versione precedente aggiunge scade_il e le due tabelle senza toccare i dati', () => {
  const env = boot();
  const ss = env.getSS(DB);
  // simula un foglio 0.7.0: niente tabelle nuove, niente colonna scade_il
  ss.sheets = ss.sheets.filter(s => s.name !== 'accessi' && s.name !== 'richieste_accesso');
  const sh = ss.getSheetByName('utenti');
  const i = sh.rows()[0].indexOf('scade_il');
  sh.rows().forEach(r => r.splice(i, 1));
  env.ctx.Db.clearCache();
  env.ctx.setupProduzione();
  assert.ok(ss.getSheetByName('accessi') && ss.getSheetByName('richieste_accesso'));
  assert.ok(ss.getSheetByName('utenti').rows()[0].includes('scade_il'));
  assert.equal(ss.getSheetByName('utenti').rows().length, 2, 'stesso utente, nessun duplicato');
  env.token = login(env);
  assert.equal(utenti(env).length, 1);
});
