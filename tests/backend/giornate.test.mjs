/**
 * 0.11.0 · giornate di un evento, orari modificabili, turni per tecnico e controllo disponibilità.
 * Backend vero con i servizi Google simulati.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, call } from '../mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';

const isoDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));

/** Istante UTC (ISO) in cui a Roma sono le `hm` del giorno `day`: i test non dipendono da ora legale o solare. */
function rome(day, hm) {
  for (const off of [0, 1, 2, 3]) {
    const d = new Date(`${day}T${hm}:00Z`);
    d.setUTCHours(d.getUTCHours() - off);
    const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    if (f.replace(' ', 'T') === `${day}T${hm}`) return d.toISOString();
  }
  throw new Error('orario non trovabile ' + day + ' ' + hm);
}

const tutto = (id, title, a, b, extra = {}) => ({ id, title, allDay: true, start: isoDay(a), end: isoDay(b), description: '', ...extra });
const orario = (id, title, giorno, da, dayFine, a, extra = {}) => ({ id, title, allDay: false, start: rome(isoDay(giorno), da), end: rome(isoDay(dayFine), a), description: '', ...extra });

function boot(cal = []) {
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: cal });
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
const grezze = (env, name) => env.getSS(DB).getSheetByName(name).rows();
const rows = (env, name) => { const [h, ...r] = grezze(env, name); return r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]]))); };
const sync = (env) => ok(call(env.ctx, 'sync.run', {}, env.token));
const eventi = (env, token = env.token) => ok(call(env.ctx, 'eventi.list', {}, token));
const ev = (env, titolo, token) => eventi(env, token).find(e => e.titolo.startsWith(titolo));
const get = (env, titolo, token = env.token) => ok(call(env.ctx, 'eventi.get', { id: ev(env, titolo, token).id }, token));
const impostaCal = (env, cal) => { env.state.calendar.events = cal; };

function utente(env, email, nome, ruolo = 'PRODUCTION') {
  ok(call(env.ctx, 'utenti.save', { email, nome, ruolo }, env.token));
  return login(env, email);
}

const aggiungi = (env, titolo, email, giorni, token = env.token) =>
  call(env.ctx, 'staff.gestisci', { evento_id: ev(env, titolo).id, azione: 'aggiungi', email, giorni }, token);
const verifica = (env, titolo, email, giorni, token = env.token) =>
  call(env.ctx, 'staff.verifica', { evento_id: ev(env, titolo).id, email, giorni }, token);
const salvaGiorno = (env, g, patch, token = env.token) => call(env.ctx, 'giorni.salva', { id: g.id, versione: g.versione, ...patch }, token);

// ---------- giornate dal Calendar ----------
test('giornate: evento di un giorno, di più giorni e a cavallo della mezzanotte', () => {
  const env = boot([
    tutto('a@g', 'Uno', 3, 4),
    tutto('b@g', 'Tre giorni', 10, 13),
    orario('c@g', 'Serata', 5, '21:00', 5, '23:30'),
    orario('d@g', 'Notte', 6, '22:00', 7, '02:00'),
    orario('e@g', 'Fino a mezzanotte', 8, '20:00', 9, '00:00'),
    orario('f@g', 'Weekend', 15, '10:00', 17, '18:00')
  ]);
  sync(env);
  const uno = ev(env, 'Uno');
  assert.equal(uno.giorni.length, 1);
  assert.deepEqual([uno.giorni[0].n, uno.giorni[0].di, uno.giorni[0].ora_inizio, uno.giorni[0].ora_fine], [1, 1, '', '']);

  const tre = ev(env, 'Tre giorni');
  assert.deepEqual(tre.giorni.map(g => g.data), [isoDay(10), isoDay(11), isoDay(12)]);
  assert.deepEqual(tre.giorni.map(g => `${g.n}/${g.di}`), ['1/3', '2/3', '3/3']);
  assert.ok(tre.giorni.every(g => g.ora_inizio === '' && g.ora_fine === ''));

  const serata = ev(env, 'Serata').giorni;
  assert.deepEqual([serata.length, serata[0].ora_inizio, serata[0].ora_fine, serata[0].dopo_mezzanotte], [1, '21:00', '23:30', false]);

  const notte = ev(env, 'Notte').giorni;
  assert.equal(notte.length, 1, 'un evento 22:00 → 02:00 è una sola giornata');
  assert.deepEqual([notte[0].data, notte[0].ora_inizio, notte[0].ora_fine, notte[0].dopo_mezzanotte], [isoDay(6), '22:00', '02:00', true]);

  const mezzanotte = ev(env, 'Fino a mezzanotte').giorni;
  assert.deepEqual([mezzanotte.length, mezzanotte[0].ora_fine, mezzanotte[0].dopo_mezzanotte], [1, '00:00', true]);

  const wk = ev(env, 'Weekend').giorni;
  assert.equal(wk.length, 3);
  assert.deepEqual(wk.map(g => [g.ora_inizio, g.ora_fine]), [['10:00', ''], ['', ''], ['', '18:00']], 'primo giorno inizio, ultimo fine, il resto da definire');
});

test('giornate: la sincronizzazione ripetuta non duplica e non scrive nulla', () => {
  const env = boot([tutto('b@g', 'Tre giorni', 10, 13)]);
  sync(env);
  const prima = rows(env, 'giorni');
  sync(env); sync(env);
  const dopo = rows(env, 'giorni');
  assert.equal(dopo.length, 3);
  assert.deepEqual(dopo, prima, 'nessuna riga cambia (nemmeno la versione)');
});

test('giornate: l\'orario corretto a mano resta dopo la sincronizzazione; se il Calendar cambia compare la differenza', () => {
  const cal = [orario('a@g', 'Concerto', 4, '21:00', 4, '23:00')];
  const env = boot(cal);
  sync(env);
  let g = ev(env, 'Concerto').giorni[0];
  assert.equal(g.origine_orario, 'calendario');
  assert.equal(g.diff, false);

  // l'Owner corregge l'orario
  const e1 = ok(salvaGiorno(env, g, { ora_inizio: '20:30', ora_fine: '00:30' }));
  g = e1.giorni[0];
  assert.deepEqual([g.ora_inizio, g.ora_fine, g.origine_orario, g.dopo_mezzanotte, g.diff], ['20:30', '00:30', 'manuale', true, false]);
  assert.deepEqual([g.cal_inizio, g.cal_fine], ['21:00', '23:00'], 'si ricorda cosa dice il Calendar');

  // sync senza cambi nel Calendar: l'orario resta, nessuna differenza
  sync(env);
  g = ev(env, 'Concerto').giorni[0];
  assert.deepEqual([g.ora_inizio, g.ora_fine, g.diff], ['20:30', '00:30', false]);

  // il Calendar cambia: l'orario manuale NON viene sovrascritto, compare la differenza
  impostaCal(env, [orario('a@g', 'Concerto', 4, '22:00', 4, '23:30')]);
  sync(env);
  g = ev(env, 'Concerto').giorni[0];
  assert.deepEqual([g.ora_inizio, g.ora_fine, g.origine_orario, g.diff, g.cal_inizio, g.cal_fine], ['20:30', '00:30', 'manuale', true, '22:00', '23:30']);
  // l'evento mostra il nuovo orario del Calendar, la giornata no
  assert.equal(ev(env, 'Concerto').ora_inizio, '22:00');

  // "tengo il mio": la differenza sparisce e l'orario resta
  g = ok(call(env.ctx, 'giorni.calendario', { id: g.id, scelta: 'tieni' }, env.token)).giorni[0];
  assert.deepEqual([g.ora_inizio, g.diff, g.origine_orario], ['20:30', false, 'manuale']);
  sync(env);
  assert.equal(ev(env, 'Concerto').giorni[0].diff, false, 'dopo "tieni" non ricompare finché il Calendar non cambia ancora');

  // il Calendar cambia di nuovo: differenza di nuovo; "uso il Calendar" riporta l'orario
  impostaCal(env, [orario('a@g', 'Concerto', 4, '22:30', 4, '23:45')]);
  sync(env);
  g = ev(env, 'Concerto').giorni[0];
  assert.equal(g.diff, true);
  g = ok(call(env.ctx, 'giorni.calendario', { id: g.id, scelta: 'usa' }, env.token)).giorni[0];
  assert.deepEqual([g.ora_inizio, g.ora_fine, g.origine_orario, g.diff], ['22:30', '23:45', 'calendario', false]);

  // da quel momento segue di nuovo il Calendar
  impostaCal(env, [orario('a@g', 'Concerto', 4, '23:00', 4, '23:59')]);
  sync(env);
  g = ev(env, 'Concerto').giorni[0];
  assert.deepEqual([g.ora_inizio, g.ora_fine, g.origine_orario], ['23:00', '23:59', 'calendario']);
});

test('giornate: riscrivere a mano l\'orario del Calendar torna "dal Calendar"', () => {
  const env = boot([orario('a@g', 'Concerto', 4, '21:00', 4, '23:00')]);
  sync(env);
  let g = ev(env, 'Concerto').giorni[0];
  g = ok(salvaGiorno(env, g, { ora_inizio: '20:00' })).giorni[0];
  assert.equal(g.origine_orario, 'manuale');
  g = ok(salvaGiorno(env, g, { ora_inizio: '21:00' })).giorni[0];
  assert.deepEqual([g.origine_orario, g.diff], ['calendario', false]);
});

test('giornate: evento esteso o accorciato nel Calendar', () => {
  const env = boot([tutto('a@g', 'Festa', 3, 5)]);
  sync(env);
  assert.equal(ev(env, 'Festa').giorni.length, 2);
  // il secondo giorno riceve una nota: se il Calendar lo toglie non sparisce
  let e = get(env, 'Festa');
  ok(call(env.ctx, 'giorni.salva', { id: e.giorni[1].id, versione: e.giorni[1].versione, nota: 'smontaggio' }, env.token));
  impostaCal(env, [tutto('a@g', 'Festa', 3, 7)]);
  sync(env);
  assert.deepEqual(ev(env, 'Festa').giorni.map(g => g.data), [isoDay(3), isoDay(4), isoDay(5), isoDay(6)]);
  impostaCal(env, [tutto('a@g', 'Festa', 3, 4)]);
  sync(env);
  const g = get(env, 'Festa').giorni;
  assert.deepEqual(g.map(x => [x.data, x.stato]), [[isoDay(3), 'attiva'], [isoDay(4), 'fuori_calendario']], 'il giorno con la nota resta, segnalato; i giorni senza modifiche spariscono');
  assert.equal(rows(env, 'giorni').filter(r => r.eliminato === 'TRUE').length, 2);
  // il Calendar lo rimette: torna attivo
  impostaCal(env, [tutto('a@g', 'Festa', 3, 5)]);
  sync(env);
  assert.deepEqual(get(env, 'Festa').giorni.map(x => x.stato), ['attiva', 'attiva']);
});

test('giornate: aggiungere, togliere (con conferma se c\'è staff), mai l\'ultima, una giornata tolta non torna con la sync', () => {
  const env = boot([tutto('a@g', 'Festa', 3, 5)]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  let e = get(env, 'Festa');
  // aggiunge il montaggio il giorno prima, con orari
  e = ok(call(env.ctx, 'giorni.aggiungi', { evento_id: e.id, data: isoDay(2), ora_inizio: '15:00', ora_fine: '19:00' }, env.token));
  assert.deepEqual(e.giorni.map(g => [g.n, g.data, g.origine]), [[1, isoDay(2), 'manuale'], [2, isoDay(3), 'calendario'], [3, isoDay(4), 'calendario']]);
  assert.equal(call(env.ctx, 'giorni.aggiungi', { evento_id: e.id, data: isoDay(2) }, env.token).error.code, 'CONFLICT');
  assert.equal(call(env.ctx, 'giorni.aggiungi', { evento_id: e.id, data: 'boh' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'giorni.aggiungi', { evento_id: e.id, data: isoDay(1), ora_inizio: '10:00', ora_fine: '10:00' }, env.token).error.code, 'INVALID');
  sync(env);
  assert.equal(get(env, 'Festa').giorni.length, 3, 'la giornata aggiunta a mano non viene toccata dalla sync');

  // Marco lavora su tutte le giornate
  ok(aggiungi(env, 'Festa', 'marco@example.com'));
  assert.equal(rows(env, 'turni').filter(t => t.eliminato !== 'TRUE').length, 3);
  // togliere una giornata con staff chiede conferma
  const g3 = get(env, 'Festa').giorni[2];
  let r = ok(call(env.ctx, 'giorni.rimuovi', { id: g3.id }, env.token));
  assert.deepEqual([r.richiede_conferma, r.turni], [true, 1]);
  assert.equal(get(env, 'Festa').giorni.length, 3, 'senza conferma non cambia nulla');
  e = ok(call(env.ctx, 'giorni.rimuovi', { id: g3.id, conferma: true }, env.token));
  assert.equal(e.giorni.length, 2);
  assert.equal(rows(env, 'turni').filter(t => t.eliminato !== 'TRUE').length, 2, 'i turni di quel giorno sono tolti');
  sync(env);
  assert.equal(get(env, 'Festa').giorni.length, 2, 'una giornata tolta a mano non torna con la sincronizzazione');
  // mai l'ultima
  const [a, b] = get(env, 'Festa').giorni;
  ok(call(env.ctx, 'giorni.rimuovi', { id: a.id, conferma: true }, env.token));
  assert.equal(call(env.ctx, 'giorni.rimuovi', { id: b.id, conferma: true }, env.token).error.code, 'INVALID');
});

test('giornate: permessi. Owner e Production modificano gli orari, il Viewer no; la nota solo a chi ha accesso all\'evento', () => {
  const env = boot([orario('a@g', 'Concerto', 4, '21:00', 4, '23:00')]);
  const prod = utente(env, 'prod@example.com', 'Paola Neri');
  const view = utente(env, 'view@example.com', 'Vito Bruni', 'VIEWER');
  sync(env);
  const g = ev(env, 'Concerto').giorni[0];
  assert.equal(ok(salvaGiorno(env, g, { ora_fine: '23:30' }, prod)).giorni[0].ora_fine, '23:30');
  const g2 = ev(env, 'Concerto').giorni[0];
  assert.equal(salvaGiorno(env, g2, { ora_fine: '23:45' }, view).ok, false);
  // la nota è un contenuto riservato allo staff assegnato: Production non assegnata non la scrive
  assert.equal(salvaGiorno(env, g2, { nota: 'portare prolunghe' }, prod).error.code, 'FORBIDDEN');
  ok(aggiungi(env, 'Concerto', 'prod@example.com'));
  assert.equal(ok(salvaGiorno(env, g2, { nota: 'portare prolunghe' }, prod)).giorni[0].nota, 'portare prolunghe');
  assert.equal(call(env.ctx, 'giorni.aggiungi', { evento_id: ev(env, 'Concerto').id, data: isoDay(2) }, view).ok, false);
  assert.equal(call(env.ctx, 'giorni.rimuovi', { id: g2.id }, view).ok, false);
  assert.equal(call(env.ctx, 'giorni.salva', { id: g2.id, ora_fine: 'xx' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'giorni.salva', { id: g2.id, versione: '99', ora_fine: '22:00' }, env.token).error.code, 'CONFLICT');
  assert.equal(call(env.ctx, 'giorni.salva', { id: g2.id, ora_inizio: '21:00', ora_fine: '21:00' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'giorni.salva', { id: g2.id }, env.token).error.code, 'INVALID', 'senza modifiche');
});

// ---------- staff per giornata ----------
test('staff: assegnare a tutte le giornate o solo ad alcune; una giornata nuova va solo a chi lavora su tutte', () => {
  const env = boot([tutto('a@g', 'Festival', 3, 6)]);
  utente(env, 'marco@example.com', 'Marco Serra');
  utente(env, 'giulia@example.com', 'Giulia Rao');
  sync(env);
  const g = ev(env, 'Festival').giorni;
  ok(aggiungi(env, 'Festival', 'marco@example.com'));
  ok(aggiungi(env, 'Festival', 'giulia@example.com', [g[0].id, g[2].id]));
  let e = get(env, 'Festival');
  assert.deepEqual(e.giorni.map(x => x.staff.map(s => s.nome)), [['Giulia Rao', 'Marco Serra'], ['Marco Serra'], ['Giulia Rao', 'Marco Serra']]);
  assert.equal(e.staff.length, 2, 'a livello evento restano le due persone');
  const att = rows(env, 'assegnazioni');
  assert.equal(att.find(r => r.email === 'marco@example.com').giorni_tutti, 'TRUE');
  assert.equal(att.find(r => r.email === 'giulia@example.com').giorni_tutti, 'FALSE');
  // nessun duplicato
  const chiavi = rows(env, 'turni').filter(t => t.eliminato !== 'TRUE').map(t => t.email + t.giorno_id);
  assert.equal(new Set(chiavi).size, chiavi.length);

  // il Calendar allunga l'evento: Marco (tutte le giornate) ha il turno nuovo, Giulia (scelta) no
  impostaCal(env, [tutto('a@g', 'Festival', 3, 7)]);
  sync(env);
  e = get(env, 'Festival');
  assert.equal(e.giorni.length, 4);
  assert.deepEqual(e.giorni[3].staff.map(s => s.nome), ['Marco Serra']);

  // cambia le giornate di Giulia: ora solo la seconda
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'giorni', email: 'giulia@example.com', giorni: [e.giorni[1].id] }, env.token));
  e = get(env, 'Festival');
  assert.deepEqual(e.giorni.map(x => x.staff.map(s => s.nome).includes('Giulia Rao')), [false, true, false, false]);
  // tutte le giornate di nuovo
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'giorni', email: 'giulia@example.com' }, env.token));
  assert.equal(rows(env, 'assegnazioni').find(r => r.email === 'giulia@example.com').giorni_tutti, 'TRUE');
  assert.equal(get(env, 'Festival').giorni.every(x => x.staff.some(s => s.nome === 'Giulia Rao')), true);

  // scelte non valide: nulla viene scritto
  const prima = rows(env, 'turni').length;
  assert.equal(aggiungi(env, 'Festival', 'marco@example.com', []).error.code, 'INVALID', 'una scelta vuota non vale');
  utente(env, 'zoe@example.com', 'Zoe Verdi');
  assert.equal(aggiungi(env, 'Festival', 'zoe@example.com', []).error.code, 'INVALID');
  assert.equal(aggiungi(env, 'Festival', 'zoe@example.com', ['gi_inesistente']).error.code, 'INVALID');
  assert.equal(rows(env, 'turni').length, prima);
  assert.equal(rows(env, 'assegnazioni').some(r => r.email === 'zoe@example.com'), false);

  // rimuovere la persona toglie i suoi turni
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'rimuovi', email: 'marco@example.com' }, env.token));
  assert.equal(rows(env, 'turni').filter(t => t.email === 'marco@example.com' && t.eliminato !== 'TRUE').length, 0);
  assert.equal(rows(env, 'turni').filter(t => t.email === 'marco@example.com').length, 4, 'le righe restano (eliminato)');
});

test('staff: confermare una proposta del Calendar crea i turni; gli orari del turno seguono la giornata finché l\'Owner non li cambia', () => {
  const env = boot([orario('a@g', 'Concerto', 4, '21:00', 4, '23:00', { description: 'Fonico Marco' })]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(call(env.ctx, 'staff.gestisci', { evento_id: ev(env, 'Concerto').id, azione: 'conferma', email: 'marco@example.com' }, env.token));
  let s = get(env, 'Concerto').giorni[0].staff[0];
  assert.deepEqual([s.email, s.ora_inizio === undefined, s.propri_inizio], ['marco@example.com', true, '']);
  // la giornata cambia: il turno senza orari propri la segue
  const g = get(env, 'Concerto').giorni[0];
  ok(salvaGiorno(env, g, { ora_inizio: '20:00' }));
  let lista = ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Concerto').id }, env.token));
  assert.equal(lista.assegnati[0].turni[0].ora_inizio, '20:00');
  // orario proprio del turno
  lista = ok(call(env.ctx, 'turni.salva', { evento_id: ev(env, 'Concerto').id, giorno_id: g.id, email: 'marco@example.com', ora_inizio: '18:00', ora_fine: '', nota: 'prova suoni' }, env.token));
  const t = lista.assegnati[0].turni[0];
  assert.deepEqual([t.ora_inizio, t.ora_fine, t.propri_inizio, t.nota], ['18:00', '23:00', '18:00', 'prova suoni']);
  // la giornata cambia ancora: l'inizio del turno resta il suo, la fine segue la giornata
  ok(salvaGiorno(env, get(env, 'Concerto').giorni[0], { ora_fine: '23:30' }));
  const t2 = ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Concerto').id }, env.token)).assegnati[0].turni[0];
  assert.deepEqual([t2.ora_inizio, t2.ora_fine], ['18:00', '23:30']);
  assert.equal(call(env.ctx, 'turni.salva', { evento_id: ev(env, 'Concerto').id, giorno_id: g.id, email: 'marco@example.com', ora_inizio: '10:00', ora_fine: '10:00' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'turni.salva', { evento_id: ev(env, 'Concerto').id, giorno_id: g.id, email: 'nessuno@example.com' }, env.token).error.code, 'NOT_FOUND');
});

// ---------- disponibilità ----------
/** Due eventi nello stesso giorno con gli orari indicati; Marco assegnato al primo. Ritorna la verifica sul secondo. */
function coppia(a, b) {
  const env = boot([
    a ? orario('a@g', 'Primo', 5, a[0], a[2] ?? 5, a[1]) : tutto('a@g', 'Primo', 5, 6),
    b ? orario('b@g', 'Secondo', 5, b[0], b[2] ?? 5, b[1]) : tutto('b@g', 'Secondo', 5, 6)
  ]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  return { env, v: ok(verifica(env, 'Secondo', 'marco@example.com')) };
}

test('disponibilità: sovrapposizione parziale e totale = rosso', () => {
  assert.equal(coppia(['18:00', '22:00'], ['21:00', '23:00']).v.livello, 'sovrapposizione');
  assert.equal(coppia(['18:00', '23:00'], ['19:00', '21:00']).v.livello, 'sovrapposizione', 'uno dentro l\'altro');
  assert.equal(coppia(['18:00', '22:00'], ['18:00', '22:00']).v.livello, 'sovrapposizione', 'identici');
});

test('disponibilità: orari che si toccano soltanto non si sovrappongono; stesso giorno con altro orario = azzurro', () => {
  const t = coppia(['18:00', '23:00'], ['23:00', '23:59']);
  assert.equal(t.v.livello, 'stesso_giorno', '23:00 / 23:00 sono contigui');
  assert.equal(t.v.giorni[0].altri[0].titolo, 'Primo');
  assert.deepEqual(t.v.liberi, [t.v.giorni[0].giorno_id], 'l\'azzurro non è un problema');
  assert.equal(coppia(['10:00', '12:00'], ['20:00', '23:00']).v.livello, 'stesso_giorno');
});

test('disponibilità: orario non definito = arancione (da verificare), data diversa = libero', () => {
  assert.equal(coppia(null, ['20:00', '23:00']).v.livello, 'da_verificare', 'manca l\'orario del primo');
  assert.equal(coppia(['20:00', '23:00'], null).v.livello, 'da_verificare', 'manca l\'orario del secondo');
  const d = coppia(null, null).v;
  assert.equal(d.livello, 'da_verificare');
  assert.deepEqual(d.liberi, [], 'i giorni da verificare non sono "liberi"');
  // un altro giorno: libero
  const env = boot([orario('a@g', 'Primo', 5, '18:00', 5, '22:00'), orario('b@g', 'Secondo', 7, '18:00', 7, '22:00')]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  const v = ok(verifica(env, 'Secondo', 'marco@example.com'));
  assert.equal(v.livello, null);
  assert.deepEqual(v.liberi, [v.giorni[0].giorno_id]);
});

test('disponibilità: la sovrapposizione vale anche a cavallo della mezzanotte', () => {
  // il primo finisce alle 02:00 del giorno dopo, il secondo (giorno dopo) inizia all'01:00
  const env = boot([orario('a@g', 'Primo', 5, '22:00', 6, '02:00'), orario('b@g', 'Secondo', 6, '01:00', 6, '05:00'), orario('c@g', 'Terzo', 6, '02:00', 6, '06:00')]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  assert.equal(ok(verifica(env, 'Secondo', 'marco@example.com')).livello, 'sovrapposizione');
  assert.equal(ok(verifica(env, 'Terzo', 'marco@example.com')).livello, null, 'finisce alle 02:00 e l\'altro inizia alle 02:00 di un altro giorno: si toccano soltanto');
});

test('disponibilità: più giornate, ognuna valutata per conto suo; "solo i giorni liberi"', () => {
  const env = boot([tutto('a@g', 'Festival', 3, 6), orario('b@g', 'Concerto', 4, '20:00', 4, '23:00')]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  const f = ev(env, 'Festival').giorni;
  // il festival ha orari definiti solo per la seconda giornata
  ok(salvaGiorno(env, f[0], { ora_inizio: '10:00', ora_fine: '18:00' }));
  ok(salvaGiorno(env, get(env, 'Festival').giorni[1], { ora_inizio: '19:00', ora_fine: '23:30' }));
  ok(salvaGiorno(env, get(env, 'Festival').giorni[2], { ora_inizio: '10:00', ora_fine: '18:00' }));
  ok(aggiungi(env, 'Concerto', 'marco@example.com'));
  const v = ok(verifica(env, 'Festival', 'marco@example.com'));
  assert.deepEqual(v.giorni.map(g => g.livello), [null, 'sovrapposizione', null]);
  assert.equal(v.livello, 'sovrapposizione');
  assert.deepEqual(v.liberi, [f[0].id, f[2].id]);
  // assegna solo i giorni liberi: nessun conflitto rimane
  ok(aggiungi(env, 'Festival', 'marco@example.com', v.liberi));
  const lista = ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Festival').id }, env.token));
  assert.equal(lista.assegnati[0].livello, null);
  assert.equal(lista.assegnati[0].turni.length, 2);
  // verifica su un sottoinsieme di giornate
  assert.equal(ok(verifica(env, 'Festival', 'marco@example.com', [f[1].id])).giorni.length, 1);
});

test('disponibilità: "assegna comunque" non è mai bloccato e il conflitto viene ricalcolato da orari, giornate e staff', () => {
  const env = boot([orario('a@g', 'Primo', 5, '18:00', 5, '22:00'), orario('b@g', 'Secondo', 5, '21:00', 5, '23:00')]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  assert.equal(ok(verifica(env, 'Secondo', 'marco@example.com')).livello, 'sovrapposizione');
  ok(aggiungi(env, 'Secondo', 'marco@example.com'));                       // assegna comunque
  const owner = (t) => get(env, t).giorni[0].staff[0];
  assert.equal(owner('Primo').livello, 'sovrapposizione');
  assert.equal(owner('Secondo').conflitti[0].titolo, 'Primo');
  assert.equal(ev(env, 'Primo').conflitti, 1);
  assert.equal(ev(env, 'Secondo').conflitti, 1);

  // cambio l'orario del secondo evento: il conflitto sparisce da solo
  ok(salvaGiorno(env, get(env, 'Secondo').giorni[0], { ora_inizio: '22:00', ora_fine: '23:30' }));
  assert.equal(owner('Primo').livello, 'stesso_giorno');
  assert.equal(ev(env, 'Primo').conflitti, 0);
  // e riappare se lo riporto indietro
  ok(salvaGiorno(env, get(env, 'Secondo').giorni[0], { ora_inizio: '20:00' }));
  assert.equal(owner('Secondo').livello, 'sovrapposizione');
  // orario del solo turno: Marco inizia più tardi al primo evento? (turno 18→20:30 vs 20:00→23:30: ancora sovrapposto; 18→20:00 no)
  const lista = (t) => ok(call(env.ctx, 'turni.salva', { evento_id: ev(env, 'Primo').id, giorno_id: get(env, 'Primo').giorni[0].id, email: 'marco@example.com', ora_inizio: '18:00', ora_fine: t }, env.token));
  assert.equal(lista('20:30').assegnati[0].livello, 'sovrapposizione');
  assert.equal(lista('20:00').assegnati[0].livello, 'stesso_giorno');
  lista('');   // il turno torna a seguire la giornata

  // tolgo Marco dal secondo: libero
  ok(call(env.ctx, 'staff.gestisci', { evento_id: ev(env, 'Secondo').id, azione: 'rimuovi', email: 'marco@example.com' }, env.token));
  assert.equal(owner('Primo').livello, null);

  // evento annullato: non fa conflitto
  ok(aggiungi(env, 'Secondo', 'marco@example.com'));
  assert.equal(owner('Primo').livello, 'sovrapposizione');
  impostaCal(env, [orario('a@g', 'Primo', 5, '18:00', 5, '22:00')]);
  sync(env);
  assert.equal(ev(env, 'Secondo').stato, 'annullato');
  assert.equal(owner('Primo').livello, null, 'un evento annullato non occupa nessuno');
  assert.equal(ok(verifica(env, 'Primo', 'marco@example.com')).livello, null);
});

test('disponibilità: i candidati e le proposte dicono già se la persona è libera', () => {
  const env = boot([
    orario('a@g', 'Primo', 5, '18:00', 5, '22:00'),
    orario('b@g', 'Secondo', 5, '21:00', 5, '23:00', { description: 'Fonico Marco' })
  ]);
  utente(env, 'marco@example.com', 'Marco Serra');
  utente(env, 'giulia@example.com', 'Giulia Rao');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  ok(aggiungi(env, 'Primo', 'giulia@example.com'));
  ok(call(env.ctx, 'staff.gestisci', { evento_id: ev(env, 'Secondo').id, azione: 'aggiungi', email: 'giulia@example.com' }, env.token));
  const l = ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Secondo').id }, env.token));
  assert.equal(l.proposte[0].email, 'marco@example.com');
  assert.equal(l.proposte[0].livello, 'sovrapposizione');
  assert.equal(l.assegnati[0].livello, 'sovrapposizione');
  // un candidato libero
  utente(env, 'zoe@example.com', 'Zoe Verdi');
  const l2 = ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Secondo').id }, env.token));
  assert.equal(l2.candidati.find(c => c.email === 'zoe@example.com').livello, null);
});

test('disponibilità: solo l\'Owner vede orari dei turni e conflitti; gli altri vedono solo i nomi', () => {
  const env = boot([orario('a@g', 'Primo', 5, '18:00', 5, '22:00'), orario('b@g', 'Secondo', 5, '21:00', 5, '23:00')]);
  const marco = utente(env, 'marco@example.com', 'Marco Serra');
  const prod = utente(env, 'prod@example.com', 'Paola Neri');
  sync(env);
  ok(aggiungi(env, 'Primo', 'marco@example.com'));
  ok(aggiungi(env, 'Secondo', 'marco@example.com'));
  for (const t of [prod, marco]) {
    assert.equal(verifica(env, 'Secondo', 'marco@example.com', undefined, t).ok, false);
    assert.equal(call(env.ctx, 'turni.salva', { evento_id: ev(env, 'Primo').id, giorno_id: get(env, 'Primo').giorni[0].id, email: 'marco@example.com', ora_inizio: '10:00' }, t).ok, false);
  }
  assert.equal(verifica(env, 'Secondo', 'marco@example.com', undefined, 'token-falso').ok, false);
  const visto = get(env, 'Primo', prod);
  assert.equal('conflitti' in visto, false);
  assert.deepEqual(Object.keys(visto.giorni[0].staff[0]).sort(), ['colore', 'id', 'nome']);
  assert.equal(JSON.stringify(ev(env, 'Primo', prod)).includes('marco@example.com'), false, 'nessuna email nell\'elenco');
  // anche Marco, assegnato, vede soltanto il nome suo e dei colleghi
  assert.equal('conflitti' in get(env, 'Primo', marco), false);
});

// ---------- manutenzione ----------
test('utenti: cambio email aggiorna i turni; eliminazione toglie solo i turni futuri', () => {
  const env = boot([tutto('a@g', 'Passato', -4, -3), tutto('b@g', 'Futuro', 5, 6)]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Passato', 'marco@example.com'));
  ok(aggiungi(env, 'Futuro', 'marco@example.com'));
  ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', email_nuova: 'marco.serra@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }, env.token));
  assert.equal(rows(env, 'turni').every(t => t.email === 'marco.serra@example.com'), true);
  ok(call(env.ctx, 'utenti.elimina', { email: 'marco.serra@example.com' }, env.token));
  const vivi = rows(env, 'turni').filter(t => t.eliminato !== 'TRUE');
  assert.equal(vivi.length, 1, 'resta la giornata già svolta');
  assert.equal(vivi[0].evento_id, ev(env, 'Passato').id);
});

test('migrazione: gli eventi e le assegnazioni già presenti ricevono giornate e turni, e rieseguirla non cambia nulla', () => {
  const env = boot([tutto('a@g', 'Festival', 3, 5), orario('b@g', 'Concerto', 8, '21:00', 8, '23:00', { description: 'Fonico Marco' })]);
  utente(env, 'marco@example.com', 'Marco Serra');
  sync(env);
  ok(aggiungi(env, 'Festival', 'marco@example.com'));
  const prima = { giorni: eventi(env).map(e => e.giorni.map(g => [g.data, g.ora_inizio, g.ora_fine, g.nota]).concat([e.id, e.titolo, e.data, e.data_fine, e.ora_inizio, e.ora_fine])), turni: rows(env, 'turni').length };
  // si simula il database di prima della 0.11.0: nessuna giornata né turno, assegnazioni senza la colonna
  env.ctx.Db.removeWhere('giorni', () => true);
  env.ctx.Db.removeWhere('turni', () => true);
  env.ctx.Db.clearCache();
  assert.equal(rows(env, 'giorni').length, 0);
  env.ctx.setupProduzione();
  const dopo = { giorni: eventi(env).map(e => e.giorni.map(g => [g.data, g.ora_inizio, g.ora_fine, g.nota]).concat([e.id, e.titolo, e.data, e.data_fine, e.ora_inizio, e.ora_fine])), turni: rows(env, 'turni').length };
  assert.deepEqual(dopo, prima);
  const snapshot = [rows(env, 'giorni'), rows(env, 'turni'), rows(env, 'assegnazioni')];
  env.ctx.setupProduzione();
  assert.deepEqual([rows(env, 'giorni'), rows(env, 'turni'), rows(env, 'assegnazioni')], snapshot, 'seconda esecuzione identica');
});

test('schema: tabelle giorni e turni create dal setup, colonne solo aggiunte', () => {
  const env = boot([]);
  assert.deepEqual(grezze(env, 'giorni')[0], ['id', 'evento_id', 'data', 'ora_inizio', 'ora_fine', 'origine', 'origine_orario', 'cal_inizio', 'cal_fine', 'cal_base', 'nota', 'stato', 'eliminato', 'creato_il', 'aggiornato_il', 'aggiornato_da', 'versione']);
  assert.deepEqual(grezze(env, 'turni')[0], ['id', 'evento_id', 'giorno_id', 'email', 'ora_inizio', 'ora_fine', 'nota', 'eliminato', 'creato_il', 'creato_da', 'aggiornato_il', 'aggiornato_da', 'versione']);
});

test('eventi manuali: le giornate seguono le date e gli orari modificati', () => {
  const env = boot([]);
  const notte = ok(call(env.ctx, 'eventi.create', { titolo: 'Cena aziendale', data: isoDay(5), data_fine: isoDay(6), ora_inizio: '20:00', ora_fine: '01:00' }, env.token));
  assert.equal(notte.giorni.length, 1, 'orari a cavallo della mezzanotte: una sola giornata');
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Convention', data: isoDay(5), data_fine: isoDay(6) }, env.token));
  assert.equal(e.giorni.length, 2);
  const u = ok(call(env.ctx, 'eventi.update', { id: e.id, versione: e.versione, data_fine: isoDay(7) }, env.token));
  assert.deepEqual(u.giorni.map(g => g.data), [isoDay(5), isoDay(6), isoDay(7)]);
});
