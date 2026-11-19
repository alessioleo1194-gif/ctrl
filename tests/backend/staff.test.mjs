/**
 * Fase 3 · staff negli eventi: proposte dalle descrizioni del Calendar, assegnazioni confermate dall'Owner,
 * documenti/file/note riservati agli assegnati, colori per persona.
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

const CAL = () => [
  { id: 'a@google.com', title: 'Cantelmo: Maria Mazzotta', allDay: true, start: isoDay(3), end: isoDay(4), description: 'Fonico Marco, referente Luca (locale)' },
  { id: 'b@google.com', title: 'Festival · giorno 1', allDay: true, start: isoDay(10), end: isoDay(11), description: 'Luci: Giulia' },
  { id: 'c@google.com', title: 'Festival · giorno 2', allDay: true, start: isoDay(11), end: isoDay(12), description: '' },
  { id: 'd@google.com', title: 'Convegno', allDay: true, start: isoDay(20), end: isoDay(21), description: 'Nessun nome' }
];

function boot(cal = CAL()) {
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
/** Righe di una scheda come oggetti (il foglio simulato restituisce la griglia con l'intestazione). */
const rows = (env, name) => { const [h, ...r] = grezze(env, name); return r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]]))); };
const b64 = (s) => Buffer.from(s).toString('base64');
const sync = (env) => ok(call(env.ctx, 'sync.run', {}, env.token));
const eventi = (env, token = env.token) => ok(call(env.ctx, 'eventi.list', {}, token));
const ev = (env, titolo, token) => eventi(env, token).find(e => e.titolo.startsWith(titolo));
const staff = (env, titolo) => ok(call(env.ctx, 'staff.evento', { evento_id: ev(env, titolo).id }, env.token));
const gestisci = (env, titolo, azione, email, token = env.token) =>
  call(env.ctx, 'staff.gestisci', { evento_id: ev(env, titolo).id, azione, email }, token);

function utente(env, email, nome, ruolo = 'PRODUCTION', extra = {}) {
  ok(call(env.ctx, 'utenti.save', { email, nome, ruolo, ...extra }, env.token));
  return login(env, email);
}

/** Utenti di esempio: Marco e Luca, e Giulia. */
function squadra(env) {
  return {
    marco: utente(env, 'marco@example.com', 'Marco Serra'),
    luca: utente(env, 'luca@example.com', 'Luca Bianchi', 'VIEWER'),
    giulia: utente(env, 'giulia@example.com', 'Giulia Rao')
  };
}

test('proposte: i nomi nella descrizione diventano proposte, solo l\'Owner le vede e nessuna vale finché non è confermata', () => {
  const env = boot();
  const t = squadra(env);
  sync(env);
  const s = staff(env, 'Cantelmo');
  assert.deepEqual(s.proposte.map(p => p.email).sort(), ['luca@example.com', 'marco@example.com']);
  const marco = s.proposte.find(p => p.email === 'marco@example.com');
  assert.equal(marco.termine, 'Marco');
  assert.match(marco.trovato, /Fonico Marco/);
  assert.equal(marco.origine, 'calendario');
  assert.deepEqual(s.assegnati, []);
  // Giulia è nel festival, non qui; l'evento senza nomi non ha proposte
  assert.deepEqual(staff(env, 'Festival · giorno 1').proposte.map(p => p.email), ['giulia@example.com']);
  assert.deepEqual(staff(env, 'Convegno').proposte, []);

  // card: nessuno staff finché non si conferma; solo l'Owner vede quante proposte ci sono
  const c = ev(env, 'Cantelmo');
  assert.deepEqual(c.staff, []);
  assert.equal(c.da_confermare, 2);
  assert.equal(ev(env, 'Cantelmo', t.marco).da_confermare, 0);
  assert.equal(ev(env, 'Cantelmo', t.marco).accesso, false, 'una proposta non dà accesso');
  assert.equal(call(env.ctx, 'staff.evento', { evento_id: c.id }, t.marco).error.code, 'FORBIDDEN');
  assert.equal(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com', t.marco).error.code, 'FORBIDDEN');
});

test('ricerca: parola intera, senza maiuscole né accenti, alias multipli e multi-parola, primo nome solo da 3 lettere', () => {
  const cal = [
    { id: 'a@google.com', title: 'Uno', allDay: true, start: isoDay(3), end: isoDay(4), description: 'Ritiro con MARCONI e Zoè; call con M. Serra. Lorenzo' },
    { id: 'b@google.com', title: 'Due', allDay: true, start: isoDay(5), end: isoDay(6), description: 'Marco arriva, Al apre la porta' }
  ];
  const env = boot(cal);
  utente(env, 'marco@example.com', 'Marco Serra');                       // senza alias: "Marco", non "Marconi"
  utente(env, 'zoe@example.com', 'Zoe Verdi', 'PRODUCTION', { nome_calendario: 'zoè' });   // accenti
  utente(env, 'ms@example.com', 'Maria Sole', 'PRODUCTION', { nome_calendario: 'Mark, M Serra' }); // multi-parola
  utente(env, 'al@example.com', 'Al Pacino');                            // "Al" è troppo corto: nessun alias automatico
  utente(env, 'lor@example.com', 'Altro', 'PRODUCTION', { nome_calendario: 'lorenzo' });
  sync(env);
  const nomi = (t) => staff(env, t).proposte.map(p => p.email).sort();
  assert.deepEqual(nomi('Uno'), ['lor@example.com', 'ms@example.com', 'zoe@example.com']);
  assert.deepEqual(nomi('Due'), ['marco@example.com']);
});

test('conferma, scarta, ripristina, rimuovi, aggiungi: stati, storico e card', () => {
  const env = boot();
  const t = squadra(env);
  sync(env);
  let s = ok(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com'));
  assert.deepEqual(s.assegnati.map(a => a.email), ['marco@example.com']);
  assert.equal(s.proposte.length, 1);
  s = ok(gestisci(env, 'Cantelmo', 'scarta', 'luca@example.com'));
  assert.deepEqual(s.scartate.map(a => a.email), ['luca@example.com']);
  assert.equal(s.proposte.length, 0);

  // card per tutti: nome e colore, io sono "mio"
  const c = ev(env, 'Cantelmo', t.marco);
  assert.equal(c.staff.length, 1);
  assert.equal(c.staff[0].nome, 'Marco Serra');
  assert.match(c.staff[0].colore, /^(blu|verde|arancio|viola|rosa|turchese|giallo|rosso)$/);
  assert.equal(c.mio, true);
  assert.equal(c.accesso, true);
  assert.equal(ev(env, 'Cantelmo', t.giulia).mio, false);
  assert.equal(ev(env, 'Cantelmo', t.giulia).staff.length, 1, 'i nomi sulle card li vedono Owner e Production');
  assert.equal(ev(env, 'Cantelmo').da_confermare, 0);

  // ripristina: lo scartato torna proposta (il nome è ancora nella descrizione)
  s = ok(gestisci(env, 'Cantelmo', 'ripristina', 'luca@example.com'));
  assert.deepEqual(s.proposte.map(a => a.email), ['luca@example.com']);

  // aggiunta manuale di chi non è nella descrizione
  s = ok(gestisci(env, 'Cantelmo', 'aggiungi', 'giulia@example.com'));
  assert.deepEqual(s.assegnati.map(a => a.email).sort(), ['giulia@example.com', 'marco@example.com']);
  assert.equal(s.assegnati.find(a => a.email === 'giulia@example.com').origine, 'manuale');
  assert.equal(ok(gestisci(env, 'Cantelmo', 'aggiungi', 'giulia@example.com')).assegnati.length, 2, 'aggiungere due volte non duplica');
  assert.equal(rows(env, 'assegnazioni').filter(r => r.email === 'giulia@example.com' && r.evento_id === c.id).length, 1);

  // rimuovi: i manuali tornano liberi, quelli del Calendar si ricordano come "non è lui"
  s = ok(gestisci(env, 'Cantelmo', 'rimuovi', 'giulia@example.com'));
  assert.deepEqual(s.assegnati.map(a => a.email), ['marco@example.com']);
  s = ok(gestisci(env, 'Cantelmo', 'rimuovi', 'marco@example.com'));
  assert.deepEqual(s.scartate.map(a => a.email), ['marco@example.com']);
  assert.equal(ev(env, 'Cantelmo', t.marco).accesso, false, 'tolto dallo staff perde l\'accesso');

  const stor = ok(call(env.ctx, 'eventi.get', { id: ev(env, 'Cantelmo').id }, env.token)).storico.filter(r => r.sezione === 'staff');
  assert.ok(stor.some(r => r.azione === 'conferma' && r.email === ADMIN));
  assert.ok(stor.some(r => r.azione === 'rimuovi'));
});

test('azioni: rifiuta valori sbagliati, doppioni e utenti non attivi', () => {
  const env = boot();
  squadra(env);
  sync(env);
  assert.equal(gestisci(env, 'Cantelmo', 'boh', 'marco@example.com').error.code, 'INVALID');
  assert.equal(gestisci(env, 'Cantelmo', 'conferma', 'non-email').error.code, 'INVALID');
  assert.equal(call(env.ctx, 'staff.gestisci', { evento_id: 'ev_inesistente', azione: 'conferma', email: 'marco@example.com' }, env.token).error.code, 'NOT_FOUND');
  assert.equal(gestisci(env, 'Cantelmo', 'conferma', 'giulia@example.com').error.code, 'NOT_FOUND', 'senza proposta non si "conferma"');
  ok(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com'));
  assert.equal(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com').error.code, 'CONFLICT');
  assert.equal(gestisci(env, 'Cantelmo', 'scarta', 'marco@example.com').error.code, 'CONFLICT');
  assert.equal(gestisci(env, 'Cantelmo', 'ripristina', 'marco@example.com').error.code, 'CONFLICT');
  assert.equal(gestisci(env, 'Cantelmo', 'aggiungi', 'sconosciuto@example.com').error.code, 'INVALID');
  ok(call(env.ctx, 'utenti.save', { email: 'giulia@example.com', nome: 'Giulia Rao', ruolo: 'PRODUCTION', attivo: false }, env.token));
  assert.equal(gestisci(env, 'Cantelmo', 'aggiungi', 'giulia@example.com').error.code, 'INVALID', 'un utente disattivato non si assegna');
  assert.equal(staff(env, 'Cantelmo').candidati.some(c => c.email === 'giulia@example.com'), false);
});

test('sync: conferme, manuali e scartati restano; le proposte decadono e ritornano con la descrizione', () => {
  const env = boot();
  squadra(env);
  sync(env);
  ok(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com'));
  ok(gestisci(env, 'Cantelmo', 'scarta', 'luca@example.com'));
  ok(gestisci(env, 'Cantelmo', 'aggiungi', 'giulia@example.com'));

  // la descrizione cambia: nessun nome → conferme e manuali restano, lo scartato resta scartato
  env.state.calendar.events[0].description = 'Solo orari';
  sync(env);
  let s = staff(env, 'Cantelmo');
  assert.deepEqual(s.assegnati.map(a => a.email).sort(), ['giulia@example.com', 'marco@example.com']);
  assert.deepEqual(s.scartate.map(a => a.email), ['luca@example.com']);

  // una proposta non gestita decade se il nome sparisce, e ritorna proposta se riappare
  env.state.calendar.events[1].description = 'Luci: Giulia';
  sync(env);
  assert.deepEqual(staff(env, 'Festival · giorno 1').proposte.map(p => p.email), ['giulia@example.com']);
  env.state.calendar.events[1].description = '';
  sync(env);
  assert.deepEqual(staff(env, 'Festival · giorno 1').proposte, []);
  assert.equal(rows(env, 'assegnazioni').find(r => r.email === 'giulia@example.com' && r.stato === 'decaduta') !== undefined, true);
  env.state.calendar.events[1].description = 'Ancora Giulia';
  sync(env);
  assert.deepEqual(staff(env, 'Festival · giorno 1').proposte.map(p => p.email), ['giulia@example.com']);

  // lo scartato non torna proposta nemmeno se il nome riappare
  env.state.calendar.events[0].description = 'Di nuovo Luca';
  sync(env);
  s = staff(env, 'Cantelmo');
  assert.deepEqual(s.scartate.map(a => a.email), ['luca@example.com']);
  assert.equal(s.proposte.length, 0);

  // una seconda sync senza cambi non scrive righe nuove
  const prima = rows(env, 'assegnazioni').length;
  sync(env);
  assert.equal(rows(env, 'assegnazioni').length, prima);
});

test('rimosso a mano: se il Calendar lo nomina di nuovo, torna come proposta', () => {
  const env = boot();
  squadra(env);
  sync(env);
  ok(gestisci(env, 'Festival · giorno 1', 'aggiungi', 'marco@example.com'));
  ok(gestisci(env, 'Festival · giorno 1', 'rimuovi', 'marco@example.com'));
  assert.equal(staff(env, 'Festival · giorno 1').scartate.length, 0, 'un manuale rimosso non è "scartato"');
  env.state.calendar.events[1].description = 'Luci: Giulia, audio Marco';
  sync(env);
  assert.deepEqual(staff(env, 'Festival · giorno 1').proposte.map(p => p.email).sort(), ['giulia@example.com', 'marco@example.com']);
});

test('alias e stato dell\'utente: cambiare nome in calendario o disattivarlo aggiorna le proposte', () => {
  const env = boot();
  squadra(env);
  sync(env);
  assert.equal(staff(env, 'Convegno').proposte.length, 0);
  ok(call(env.ctx, 'utenti.save', { email: 'giulia@example.com', nome: 'Giulia Rao', ruolo: 'PRODUCTION', nome_calendario: 'Nessun' }, env.token));
  assert.deepEqual(staff(env, 'Convegno').proposte.map(p => p.email), ['giulia@example.com'], 'subito, senza aspettare la sync');
  ok(call(env.ctx, 'utenti.save', { email: 'giulia@example.com', nome: 'Giulia Rao', ruolo: 'PRODUCTION', attivo: false }, env.token));
  assert.deepEqual(staff(env, 'Convegno').proposte, [], 'un utente disattivato non è più proposto');
  assert.equal(call(env.ctx, 'utenti.list', {}, env.token).data.find(u => u.email === 'giulia@example.com').nome_calendario, 'Nessun', 'salvare senza alias non lo cancella');
});

test('utenti scaduti non vengono proposti', () => {
  const env = boot();
  ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION', scade_il: isoDay(-1) }, env.token));
  sync(env);
  assert.deepEqual(staff(env, 'Cantelmo').proposte, []);
});

test('eventi manuali: la descrizione scritta in CTRL genera proposte', () => {
  const env = boot([]);
  squadra(env);
  const e = ok(call(env.ctx, 'eventi.create', { titolo: 'Manuale', data: isoDay(2), descrizione: 'con Giulia al mixer' }, env.token));
  assert.deepEqual(ok(call(env.ctx, 'staff.evento', { evento_id: e.id }, env.token)).proposte.map(p => p.email), ['giulia@example.com']);
  ok(call(env.ctx, 'eventi.update', { id: e.id, descrizione: 'senza nomi' }, env.token));
  assert.deepEqual(ok(call(env.ctx, 'staff.evento', { evento_id: e.id }, env.token)).proposte, []);
});

test('riservato: Production non assegnato vede l\'evento ma non note, file, documenti; il Viewer non lo vede proprio', () => {
  const env = boot();
  const t = squadra(env);
  const e = ev(env, 'Cantelmo');
  const file = { evento_id: e.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: b64('%PDF-1.4 x') };
  ok(call(env.ctx, 'allegati.carica', file, env.token));
  ok(call(env.ctx, 'eventi.update', { id: e.id, note: 'Carico alle 15' }, env.token));
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: e.id }, env.token));
  ok(call(env.ctx, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '0', dati: { crew: [{ nome: 'Rossi' }], giorni: [] } }, env.token));

  // il Viewer non assegnato non vede nulla: né nell'elenco né aprendo l'evento
  assert.equal(eventi(env, t.luca).length, 0);
  assert.equal(call(env.ctx, 'eventi.get', { id: e.id }, t.luca).error.code, 'NOT_FOUND');
  for (const token of [t.marco]) {
    assert.equal(eventi(env, token).length, 4, 'Production vede tutti gli eventi');
    const l = ev(env, 'Cantelmo', token);
    assert.equal(l.note, '', 'le note non escono nemmeno dalla lista');
    assert.equal(l.accesso, false);
    assert.equal(l.descrizione, 'Fonico Marco, referente Luca (locale)', 'la descrizione resta visibile');
    assert.equal(l.stato_doc.scheda, true, 'gli indicatori di presenza restano visibili');
    const g = ok(call(env.ctx, 'eventi.get', { id: e.id }, token));
    assert.equal(g.accesso, false);
    assert.equal(g.allegati, null);
    assert.equal(g.produzione, null);
    assert.equal(g.note, '');
    assert.equal(g.titolo, 'Cantelmo: Maria Mazzotta');
    // anche chiamando le azioni a mano
    const idAllegato = ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).allegati.scheda[0].id;
    for (const [azione, payload] of [
      ['allegati.scarica', { id: idAllegato }],
      ['allegati.elimina', { id: idAllegato }],
      ['allegati.carica', file],
      ['produzione.assicura', { evento_id: e.id }],
      ['documento.get', { produzione_id: pr.id, tipo: 'plan' }],
      ['documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '1', dati: { crew: [], giorni: [] } }],
      ['documento.pdf', { produzione_id: pr.id, tipo: 'plan', nome: 'Production Plan - x.pdf', dati: b64('%PDF-1.4 x') }],
      ['eventi.update', { id: e.id, note: 'hack' }]
    ]) {
      const r = call(env.ctx, azione, payload, token);
      assert.equal(r.ok, false, azione);
      assert.equal(r.error.code, 'FORBIDDEN', azione + ' ' + JSON.stringify(r));
    }
  }
  assert.equal(ok(call(env.ctx, 'eventi.get', { id: e.id }, env.token)).note, 'Carico alle 15', 'le note non sono state toccate');
  assert.equal(ev(env, 'Cantelmo').note, 'Carico alle 15', 'l\'Owner vede tutto');
});

test('assegnato: Production lavora, Viewer legge, e solo sull\'evento (o produzione) a cui è assegnato', () => {
  const env = boot();
  const t = squadra(env);
  sync(env);
  const e = ev(env, 'Cantelmo');
  ok(gestisci(env, 'Cantelmo', 'conferma', 'marco@example.com'));
  ok(gestisci(env, 'Cantelmo', 'aggiungi', 'luca@example.com'));

  const g = ok(call(env.ctx, 'eventi.get', { id: e.id }, t.marco));
  assert.equal(g.accesso, true);
  assert.ok(g.allegati);
  const file = { evento_id: e.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: b64('%PDF-1.4 x') };
  const s = ok(call(env.ctx, 'allegati.carica', file, t.marco));
  ok(call(env.ctx, 'eventi.update', { id: e.id, note: 'Parcheggio dietro' }, t.marco));
  assert.equal(ev(env, 'Cantelmo', t.marco).note, 'Parcheggio dietro');
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: e.id }, t.marco));
  ok(call(env.ctx, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '0', dati: { crew: [], giorni: [] } }, t.marco));

  // Viewer assegnato: vede l'evento, legge e scarica i file allegati; Plan e Material List non si aprono né si creano
  assert.equal(call(env.ctx, 'documento.get', { produzione_id: pr.id, tipo: 'plan' }, t.luca).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'documento.get', { produzione_id: pr.id, tipo: 'materiali' }, t.luca).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'produzione.assicura', { evento_id: e.id }, t.luca).error.code, 'FORBIDDEN');
  const vl = ok(call(env.ctx, 'eventi.get', { id: e.id }, t.luca));
  assert.equal(vl.accesso, true);
  assert.equal(vl.produzione, null, 'il Viewer non riceve nemmeno il riepilogo dei documenti');
  assert.equal(vl.produzione_id, '');
  assert.equal(ev(env, 'Cantelmo', t.luca).produzione_id, '');
  assert.equal(ev(env, 'Cantelmo', t.marco).produzione_id, pr.id, 'chi lavora sul piano lo riceve');
  ok(call(env.ctx, 'allegati.scarica', { id: s.allegati[0].id }, t.luca));
  assert.equal(call(env.ctx, 'allegati.carica', file, t.luca).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '1', dati: {} }, t.luca).error.code, 'FORBIDDEN');

  // un'altra persona e un altro evento restano chiusi
  assert.equal(call(env.ctx, 'documento.get', { produzione_id: pr.id, tipo: 'plan' }, t.giulia).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'produzione.assicura', { evento_id: ev(env, 'Convegno').id }, t.marco).error.code, 'FORBIDDEN');
});

test('festival: essere assegnati a un giorno apre piano, materiale e file di tutta la produzione, non di altre', () => {
  const env = boot();
  const t = squadra(env);
  sync(env);
  const g1 = ev(env, 'Festival · giorno 1'), g2 = ev(env, 'Festival · giorno 2');
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: g1.id }, env.token));
  ok(call(env.ctx, 'produzione.collega', { id: pr.id, evento_id: g2.id }, env.token));
  const altra = ok(call(env.ctx, 'produzione.assicura', { evento_id: ev(env, 'Cantelmo').id }, env.token));
  ok(call(env.ctx, 'allegati.carica', { evento_id: g2.id, sezione: 'piano', nome: 'p.pdf', mime: 'application/pdf', dati: b64('%PDF-1.4 p') }, env.token));
  ok(gestisci(env, 'Festival · giorno 1', 'conferma', 'giulia@example.com'));

  assert.equal(ev(env, 'Festival · giorno 2', t.giulia).accesso, true, 'il giorno 2 condivide la produzione');
  assert.equal(ev(env, 'Festival · giorno 2', t.giulia).mio, false, '"i miei" sono solo quelli assegnati davvero');
  ok(call(env.ctx, 'documento.get', { produzione_id: pr.id, tipo: 'plan' }, t.giulia));
  const g = ok(call(env.ctx, 'eventi.get', { id: g2.id }, t.giulia));
  assert.equal(g.allegati.piano.length, 1);
  assert.equal(call(env.ctx, 'documento.get', { produzione_id: altra.id, tipo: 'plan' }, t.giulia).error.code, 'FORBIDDEN');
  assert.equal(ev(env, 'Cantelmo', t.giulia).accesso, false);
  // un utente assegnato non può collegare eventi che non vede né toglierli da produzioni altrui
  assert.equal(call(env.ctx, 'produzione.collega', { id: pr.id, evento_id: ev(env, 'Convegno').id }, t.giulia).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'produzione.scollega', { id: altra.id, evento_id: ev(env, 'Cantelmo').id }, t.giulia).error.code, 'FORBIDDEN');
});

test('colori: assegnati al meno usato, cambiabili dall\'Owner, validati, stabili per persona', () => {
  const env = boot([]);
  const col = (email) => ok(call(env.ctx, 'utenti.list', {}, env.token)).find(u => u.email === email).colore;
  const proprietario = col(ADMIN);
  assert.match(proprietario, /^[a-z]+$/);
  const nuovi = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(x => {
    ok(call(env.ctx, 'utenti.save', { email: x + '@example.com', nome: x, ruolo: 'VIEWER' }, env.token));
    return col(x + '@example.com');
  });
  assert.equal(new Set([proprietario, ...nuovi.slice(0, 7)]).size, 8, 'i primi 8 hanno colori tutti diversi');
  assert.ok(nuovi[7], 'dal nono in poi i colori si ripetono');

  ok(call(env.ctx, 'utenti.save', { email: 'a@example.com', nome: 'a', ruolo: 'VIEWER', colore: 'rosso' }, env.token));
  assert.equal(col('a@example.com'), 'rosso');
  ok(call(env.ctx, 'utenti.save', { email: 'a@example.com', nome: 'a nuovo', ruolo: 'VIEWER' }, env.token));
  assert.equal(col('a@example.com'), 'rosso', 'salvare senza colore non lo cambia');
  assert.equal(call(env.ctx, 'utenti.save', { email: 'a@example.com', nome: 'a', ruolo: 'VIEWER', colore: 'fucsia' }, env.token).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.save', { email: 'a@example.com', nome: 'a', ruolo: 'VIEWER', colore: 'rosso' }, 'x').ok, false);

  // il profilo porta id e colore, per riconoscersi nelle liste
  const tok = login(env, 'a@example.com');
  const me = ok(call(env.ctx, 'auth.me', {}, tok));
  assert.equal(me.colore, 'rosso');
  assert.match(me.id, /^usr_/);
});

test('migrazione: setup dà un colore a chi non lo ha e un secondo setup non lo cambia', () => {
  const env = boot([]);
  for (const x of ['v', 'w']) ok(call(env.ctx, 'utenti.save', { email: x + '@example.com', nome: x, ruolo: 'VIEWER' }, env.token));
  const prima = Object.fromEntries(rows(env, 'utenti').map(u => [u.email, u.colore]));
  assert.ok(Object.values(prima).every(Boolean));

  // si svuota il colore di due utenti, come in un database creato prima della Fase 3
  const dati = grezze(env, 'utenti');
  const ic = dati[0].indexOf('colore'), ie = dati[0].indexOf('email');
  for (const r of dati.slice(1)) if (r[ie] === 'v@example.com' || r[ie] === ADMIN) r[ic] = '';
  env.ctx.setupProduzione();
  const dopo = Object.fromEntries(rows(env, 'utenti').map(u => [u.email, u.colore]));
  assert.ok(Object.values(dopo).every(c => ['blu', 'verde', 'arancio', 'viola', 'rosa', 'turchese', 'giallo', 'rosso'].includes(c)));
  assert.equal(dopo['w@example.com'], prima['w@example.com'], 'chi aveva già un colore lo tiene');
  assert.equal(new Set(Object.values(dopo)).size, 3, 'ai due senza colore va il meno usato: tutti diversi');
  env.ctx.setupProduzione();
  assert.deepEqual(Object.fromEntries(rows(env, 'utenti').map(u => [u.email, u.colore])), dopo, 'il secondo setup non cambia nulla');
});

test('schema: tabella assegnazioni e colonne nuove create dal setup', () => {
  const env = boot([]);
  assert.deepEqual(grezze(env, 'assegnazioni')[0], ['id', 'evento_id', 'email', 'stato', 'origine', 'trovato', 'termine', 'creata_il', 'creata_da', 'aggiornata_il', 'aggiornata_da', 'giorni_tutti']);
  const head = grezze(env, 'utenti')[0];
  assert.ok(head.includes('nome_calendario') && head.includes('colore'));
  assert.equal(ok(call(env.ctx, 'impostazioni.get', {}, env.token)).sync !== undefined, true);
});
