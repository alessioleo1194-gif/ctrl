/**
 * 0.13.2 · dati del Calendar corretti in CTRL: restano dopo la sincronizzazione, le differenze si segnalano, il Calendar non si tocca.
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
const ev = (env, titolo, token) => eventi(env, token)[0];   // in questi test c'è un solo evento: il titolo cambia, quindi non si cerca per nome
const get = (env, titolo, token = env.token) => ok(call(env.ctx, 'eventi.get', { id: ev(env, titolo, token).id }, token));
const impostaCal = (env, cal) => { env.state.calendar.events = cal; };

const base = () => [{ ...tutto('a@g', 'Cantelmo: Salento Jaz', 3, 4), location: 'Cantelmo, Lecce', description: 'Referente Luca' }];
const modifica = (env, titolo, campi) => { const e = get(env, titolo); return call(env.ctx, 'eventi.update', { id: e.id, versione: e.versione, ...campi }, env.token); };

test('correzione: titolo, luogo, descrizione e date si cambiano e restano dopo la sincronizzazione', () => {
  const env = boot(base());
  sync(env);
  const prima = get(env, 'Cantelmo');
  assert.equal(prima.origine, 'calendar');
  const r = ok(modifica(env, 'Cantelmo', { titolo: 'Cantelmo: Salento Jazz', luogo: 'Officine Cantelmo, Lecce', descrizione: 'Referente Luca, tel 333', data: isoDay(4), data_fine: isoDay(4) }));
  assert.equal(r.titolo, 'Cantelmo: Salento Jazz');
  assert.equal(r.data, isoDay(4));
  assert.deepEqual(Object.keys(r.correzioni).sort(), ['data', 'data_fine', 'descrizione', 'luogo', 'titolo']);
  assert.equal(r.correzioni.titolo.calendario, 'Cantelmo: Salento Jaz');
  assert.equal(r.correzioni.titolo.nuovo, null);
  // la sincronizzazione con lo stesso Calendar non cancella niente
  sync(env); sync(env);
  const dopo = get(env, 'Cantelmo');
  assert.equal(dopo.titolo, 'Cantelmo: Salento Jazz');
  assert.equal(dopo.luogo, 'Officine Cantelmo, Lecce');
  assert.equal(dopo.data, isoDay(4));
  assert.deepEqual(dopo.correzioni.titolo, { calendario: 'Cantelmo: Salento Jaz', nuovo: null });
  // le giornate seguono la data corretta
  assert.deepEqual(dopo.giorni.map(g => g.data), [isoDay(4)]);
  // lo storico lo racconta
  assert.ok(rows(env, 'storico').some(s => s.sezione === 'evento' && s.azione === 'modifica' && /Jazz/.test(s.dopo)));
});

test('correzione: se il Calendar cambia un dato corretto si segnala la differenza e non si sovrascrive', () => {
  const env = boot(base());
  sync(env);
  ok(modifica(env, 'Cantelmo', { luogo: 'Officine Cantelmo, Lecce' }));
  impostaCal(env, [{ ...base()[0], title: 'Cantelmo: Salento Jaz (nuovo)', location: 'Teatro Paisiello, Lecce' }]);
  sync(env);
  const e = get(env, 'Cantelmo');
  assert.equal(e.luogo, 'Officine Cantelmo, Lecce', 'il valore tuo resta');
  assert.equal(e.titolo, 'Cantelmo: Salento Jaz (nuovo)', 'i dati non corretti seguono il Calendar');
  assert.deepEqual(e.correzioni.luogo, { calendario: 'Cantelmo, Lecce', nuovo: 'Teatro Paisiello, Lecce' });
  // tieni: la differenza sparisce, il valore resta, il riferimento diventa il Calendar di adesso
  const k = ok(call(env.ctx, 'eventi.calendario', { id: e.id, campo: 'luogo', scelta: 'tieni' }, env.token));
  assert.equal(k.luogo, 'Officine Cantelmo, Lecce');
  assert.deepEqual(k.correzioni.luogo, { calendario: 'Teatro Paisiello, Lecce', nuovo: null });
  sync(env);
  assert.equal(get(env, 'Cantelmo').correzioni.luogo.nuovo, null, 'non si ripresenta finché il Calendar non cambia ancora');
  // il Calendar cambia di nuovo e stavolta si sceglie quello del Calendar
  impostaCal(env, [{ ...base()[0], title: 'Cantelmo: Salento Jaz (nuovo)', location: 'Piazza Sant\'Oronzo' }]);
  sync(env);
  assert.equal(get(env, 'Cantelmo').correzioni.luogo.nuovo, 'Piazza Sant\'Oronzo');
  const u = ok(call(env.ctx, 'eventi.calendario', { id: e.id, campo: 'luogo', scelta: 'usa' }, env.token));
  assert.equal(u.luogo, 'Piazza Sant\'Oronzo');
  assert.equal(u.correzioni.luogo, undefined);
  sync(env);
  assert.equal(get(env, 'Cantelmo').luogo, 'Piazza Sant\'Oronzo', 'dopo il ripristino torna a seguire il Calendar');
});

test('correzione: ripristino senza differenze e correzione uguale al Calendar', () => {
  const env = boot(base());
  sync(env);
  const e0 = get(env, 'Cantelmo');
  ok(modifica(env, 'Cantelmo', { titolo: 'Altro titolo' }));
  const r = ok(call(env.ctx, 'eventi.calendario', { id: e0.id, scelta: 'usa' }, env.token));
  assert.equal(r.titolo, 'Cantelmo: Salento Jaz');
  assert.equal(Object.keys(r.correzioni).length, 0);
  // scrivere di nuovo il valore del Calendar equivale a non aver corretto niente
  ok(modifica(env, 'Cantelmo', { titolo: 'Altro titolo' }));
  const e1 = ok(modifica(env, 'Cantelmo', { titolo: 'Cantelmo: Salento Jaz' }));
  assert.equal(Object.keys(e1.correzioni).length, 0);
  // il Calendar arriva dove l'avevi già portato tu: la correzione decade da sola
  ok(modifica(env, 'Cantelmo', { luogo: 'Teatro X' }));
  impostaCal(env, [{ ...base()[0], location: 'Teatro X' }]);
  sync(env);
  assert.equal(get(env, 'Cantelmo').correzioni.luogo, undefined);
});

test('correzione: solo l\'Owner; il Calendar non viene mai scritto; Production e Viewer rifiutati', () => {
  const env = boot(base());
  sync(env);
  const e = get(env, 'Cantelmo');
  ok(call(env.ctx, 'utenti.save', { email: 'prod@example.com', nome: 'Prod', ruolo: 'PRODUCTION' }, env.token));
  ok(call(env.ctx, 'utenti.save', { email: 'viewer@example.com', nome: 'Viola', ruolo: 'VIEWER' }, env.token));
  for (const email of ['prod@example.com', 'viewer@example.com']) {
    const t = login(env, email);
    assert.equal(call(env.ctx, 'eventi.update', { id: e.id, versione: e.versione, titolo: 'X' }, t).error.code, 'FORBIDDEN');
    assert.equal(call(env.ctx, 'eventi.calendario', { id: e.id, scelta: 'usa' }, t).error.code, 'FORBIDDEN');
  }
  ok(modifica(env, 'Cantelmo', { titolo: 'Corretto' }));
  assert.equal(get(env, 'Cantelmo', login(env, 'prod@example.com')).correzioni, undefined, 'le correzioni con i valori del Calendar sono solo per l\'Owner');
  assert.equal(env.state.calendar.writes ? env.state.calendar.writes.length : 0, 0);
  assert.equal(call(env.ctx, 'eventi.calendario', { id: e.id, campo: 'colore', scelta: 'usa' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'eventi.calendario', { id: e.id, scelta: 'boh' }, env.token).error.code, 'INVALID');
});

test('correzione: la descrizione corretta aggiorna le proposte staff; date non valide rifiutate', () => {
  const env = boot(base());
  ok(call(env.ctx, 'utenti.save', { email: 'luca@example.com', nome: 'Luca Bianchi', ruolo: 'VIEWER', nome_calendario: 'Luca' }, env.token));
  sync(env);
  const staff = (t) => ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, 'Cantelmo').id }, env.token));
  assert.ok(staff().proposte.some(p => p.email === 'luca@example.com'));
  ok(modifica(env, 'Cantelmo', { descrizione: 'Nessuno' }));
  assert.equal(staff().proposte.some(p => p.email === 'luca@example.com'), false);
  assert.equal(modifica(env, 'Cantelmo', { data: 'ieri' }).error.code, 'INVALID');
  assert.equal(modifica(env, 'Cantelmo', { data: isoDay(8), data_fine: isoDay(6) }).error.code, 'INVALID');
});
