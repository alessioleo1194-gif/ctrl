/**
 * Gestione utenti completa: email modificabile, eliminazione (riga conservata), permessi particolari,
 * Owner con il suo nome, sessione persistente. Backend vero con i servizi Google simulati.
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
  const env = loadBackend({
    adminEmail: ADMIN,
    calendarEvents: [
      { id: 'a@google.com', title: 'Cantelmo: Concerto', allDay: true, start: isoDay(3), end: isoDay(4), description: 'Fonico Marco' },
      { id: 'b@google.com', title: 'Convegno', allDay: true, start: isoDay(8), end: isoDay(9) }
    ]
  });
  env.ctx.setupProduzione();
  env.token = login(env);
  return env;
}

function codice(env, email) {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  return env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
}
function loginRes(env, email = ADMIN) { return call(env.ctx, 'auth.verifyCode', { email, code: codice(env, email), dispositivo: 'Test' }); }
function login(env, email = ADMIN) { const r = loginRes(env, email); assert.equal(r.ok, true, JSON.stringify(r)); return r.data.token; }

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const grezze = (env, name) => env.getSS(DB).getSheetByName(name).rows();
const rows = (env, name) => { const [h, ...r] = grezze(env, name); return r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]]))); };
const salva = (env, u) => call(env.ctx, 'utenti.save', { nome: u.email, ruolo: 'VIEWER', ...u }, env.token);
const elenco = (env) => ok(call(env.ctx, 'utenti.list', {}, env.token));
const accessi = (env) => ok(call(env.ctx, 'accessi.list', { limite: 200 }, env.token)).righe;
const eventi = (env, token = env.token) => ok(call(env.ctx, 'eventi.list', {}, token));
const assegna = (env, titolo, email) => {
  const e = eventi(env).find(x => x.titolo.startsWith(titolo));
  ok(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email }, env.token));
  return e;
};

test('Owner: si presenta con il suo nome, non come Admin; il setup corregge il nome vecchio ed è ripetibile', () => {
  const env = boot();
  const prof = loginRes(env).data.utente;
  assert.equal(prof.nome, 'Alessio Leo');
  assert.equal(elenco(env).find(u => u.email === ADMIN).nome, 'Alessio Leo');
  // un nome generico scritto nel foglio non si vede mai
  ok(call(env.ctx, 'utenti.save', { email: ADMIN, ruolo: 'OWNER', nome: 'Admin' }, env.token));
  assert.equal(rows(env, 'utenti').find(u => u.email === ADMIN).nome, 'Admin');
  assert.equal(elenco(env).find(u => u.email === ADMIN).nome, 'Alessio Leo');
  // il setup lo riscrive; un secondo setup non cambia nulla
  env.ctx.setupProduzione();
  assert.equal(rows(env, 'utenti').find(u => u.email === ADMIN).nome, 'Alessio Leo');
  const v = rows(env, 'utenti').find(u => u.email === ADMIN).versione;
  env.ctx.setupProduzione();
  assert.equal(rows(env, 'utenti').find(u => u.email === ADMIN).versione, v);
  // chi è assegnato a un evento vede "Alessio Leo", non "Admin"
  ok(call(env.ctx, 'utenti.save', { email: ADMIN, ruolo: 'OWNER', nome: 'Alessio Leo' }, env.token));
  const e = assegna(env, 'Cantelmo', ADMIN);
  const staff = eventi(env).find(x => x.id === e.id).staff;
  assert.deepEqual(staff.map(s => s.nome), ['Alessio Leo']);
});

test('email modificabile: stesso profilo, assegnazioni e colore seguono, sessioni chiuse, la vecchia email non entra più', () => {
  const env = boot();
  ok(salva(env, { email: 'marco@example.com', nome: 'Marco Rossi', ruolo: 'PRODUCTION' }));
  const tok = login(env, 'marco@example.com');
  const prima = rows(env, 'utenti').find(u => u.email === 'marco@example.com');   // dopo il login: la versione è quella corrente
  const e = assegna(env, 'Cantelmo', 'marco@example.com');
  const r = ok(call(env.ctx, 'utenti.save', { email: 'marco@example.com', email_nuova: ' Marco.Rossi@Example.com ', nome: 'Marco Rossi', ruolo: 'PRODUCTION', versione: prima.versione }, env.token));
  assert.equal(r.email, 'marco.rossi@example.com');
  const dopo = rows(env, 'utenti').filter(u => u.nome === 'Marco Rossi');
  assert.equal(dopo.length, 1, 'nessun utente duplicato');
  assert.equal(dopo[0].id, prima.id);
  assert.equal(dopo[0].colore, prima.colore);
  assert.equal(dopo[0].email, 'marco.rossi@example.com');
  // la sessione aperta con la vecchia email non vale più
  assert.equal(call(env.ctx, 'eventi.list', {}, tok).error.code, 'AUTH_REQUIRED');
  // la vecchia email non riceve il codice, la nuova sì
  env.state.cache.clear();
  const prec = env.state.mails.length;
  call(env.ctx, 'auth.requestCode', { email: 'marco@example.com' });
  assert.equal(env.state.mails.length, prec, 'nessuna email alla vecchia casella');
  const tok2 = login(env, 'marco.rossi@example.com');
  // l'assegnazione all'evento è passata alla nuova email: vede ancora i documenti
  const ev = ok(call(env.ctx, 'eventi.get', { id: e.id }, tok2));
  assert.equal(ev.accesso, true);
  assert.ok(rows(env, 'assegnazioni').every(a => a.email !== 'marco@example.com'));
  assert.ok(accessi(env).some(x => x.evento === 'email_cambiata' && /marco@example.com → marco.rossi@example.com/.test(x.dettaglio)));
  assert.equal(elenco(env).filter(u => u.email === 'marco@example.com').length, 0);
});

test('un accesso del tecnico mentre l\'Owner ha aperta la sua scheda non fa risultare "modificato da un altro utente"', () => {
  const env = boot();
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER' }));
  const aperta = elenco(env).find(u => u.email === 'v@example.com');          // l'Owner apre la scheda
  login(env, 'v@example.com');                                                  // intanto il tecnico entra
  ok(call(env.ctx, 'utenti.save', { email: 'v@example.com', nome: 'Vittoria Neri', ruolo: 'VIEWER', versione: aperta.versione }, env.token));
  // ma una vera modifica nel frattempo (altro Owner/scheda) continua a dare conflitto
  assert.equal(call(env.ctx, 'utenti.save', { email: 'v@example.com', nome: 'X', ruolo: 'VIEWER', versione: aperta.versione }, env.token).error.code, 'CONFLICT');
});

test('email modificabile: rifiuta email già usate, non valide, riservate; il proprietario non cambia email', () => {
  const env = boot();
  ok(salva(env, { email: 'a@example.com', ruolo: 'VIEWER' }));
  ok(salva(env, { email: 'b@example.com', ruolo: 'VIEWER' }));
  const cambia = (da, a) => call(env.ctx, 'utenti.save', { email: da, email_nuova: a, nome: 'X', ruolo: 'VIEWER' }, env.token);
  assert.equal(cambia('a@example.com', 'b@example.com').error.code, 'CONFLICT');
  assert.equal(cambia('a@example.com', 'non-email').error.code, 'INVALID');
  assert.equal(cambia('a@example.com', ADMIN).error.code, 'INVALID');
  assert.equal(cambia('nessuno@example.com', 'c@example.com').error.code, 'NOT_FOUND');
  assert.equal(call(env.ctx, 'utenti.save', { email: ADMIN, email_nuova: 'altro@example.com', nome: 'X', ruolo: 'OWNER' }, env.token).error.code, 'INVALID');
  assert.equal(elenco(env).filter(u => u.email === ADMIN).length, 1);
  // anche una email di un utente eliminato è occupata (la riga resta)
  ok(call(env.ctx, 'utenti.elimina', { email: 'b@example.com' }, env.token));
  assert.equal(cambia('a@example.com', 'b@example.com').error.code, 'CONFLICT');
  // solo l'Owner cambia le email
  const tok = login(env, 'a@example.com');
  assert.equal(call(env.ctx, 'utenti.save', { email: 'a@example.com', email_nuova: 'z@example.com', nome: 'X', ruolo: 'VIEWER' }, tok).error.code, 'FORBIDDEN');
});

test('elimina: la riga resta, non entra più, sessioni chiuse, sparisce dall\'elenco e dagli eventi; il registro resta', () => {
  const env = boot();
  ok(salva(env, { email: 'tec@example.com', nome: 'Tec', ruolo: 'PRODUCTION' }));
  const tok = login(env, 'tec@example.com');
  const e = assegna(env, 'Cantelmo', 'tec@example.com');
  assert.equal(eventi(env).find(x => x.id === e.id).staff.length, 1);
  const r = ok(call(env.ctx, 'utenti.elimina', { email: 'tec@example.com' }, env.token));
  assert.deepEqual([r.sessioni_chiuse, r.assegnazioni_tolte], [1, 1]);
  const riga = rows(env, 'utenti').find(u => u.email === 'tec@example.com');
  assert.ok(riga, 'nessuna cancellazione fisica');
  assert.equal(riga.eliminato, 'TRUE');
  assert.equal(riga.attivo, 'FALSE');
  assert.ok(riga.eliminato_il);
  assert.equal(elenco(env).some(u => u.email === 'tec@example.com'), false);
  assert.equal(call(env.ctx, 'eventi.list', {}, tok).error.code, 'AUTH_REQUIRED');
  assert.equal(eventi(env).find(x => x.id === e.id).staff.length, 0);
  assert.equal(rows(env, 'assegnazioni').find(a => a.email === 'tec@example.com').stato, 'rimossa');
  // niente codice per chi è stato eliminato (come per uno sconosciuto)
  env.state.cache.clear();
  const prec = env.state.mails.length;
  call(env.ctx, 'auth.requestCode', { email: 'tec@example.com' });
  assert.equal(env.state.mails.length, prec);
  assert.ok(accessi(env).some(x => x.evento === 'eliminato' && x.email === 'tec@example.com'), 'registro conserva l\'eliminazione');
  assert.ok(accessi(env).some(x => x.evento === 'utente_creato' && x.email === 'tec@example.com'), 'e la creazione');
  // non si elimina due volte
  assert.equal(call(env.ctx, 'utenti.elimina', { email: 'tec@example.com' }, env.token).error.code, 'NOT_FOUND');
});

test('elimina: il proprietario no, gli altri utenti no; la stessa email si può registrare di nuovo (riattivata, senza vecchi permessi)', () => {
  const env = boot();
  assert.equal(call(env.ctx, 'utenti.elimina', { email: ADMIN }, env.token).error.code, 'INVALID');
  ok(salva(env, { email: 'p@example.com', nome: 'P', ruolo: 'PRODUCTION', permessi_extra: ['tutti_documenti'] }));
  const tokP = login(env, 'p@example.com');
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER' }));
  assert.equal(call(env.ctx, 'utenti.elimina', { email: 'v@example.com' }, tokP).error.code, 'FORBIDDEN');
  assert.equal(elenco(env).some(u => u.email === 'v@example.com'), true);
  ok(call(env.ctx, 'utenti.elimina', { email: 'p@example.com' }, env.token));
  const prima = rows(env, 'utenti').find(u => u.email === 'p@example.com');
  ok(salva(env, { email: 'p@example.com', nome: 'Paolo Verdi', ruolo: 'VIEWER' }));
  const dopo = rows(env, 'utenti').filter(u => u.email === 'p@example.com');
  assert.equal(dopo.length, 1, 'stessa riga');
  assert.equal(dopo[0].id, prima.id);
  assert.equal(dopo[0].eliminato, '');
  assert.equal(dopo[0].permessi_extra, '', 'i vecchi permessi particolari non tornano');
  const u = elenco(env).find(x => x.email === 'p@example.com');
  assert.deepEqual([u.nome, u.ruolo, u.attivo], ['Paolo Verdi', 'VIEWER', true]);
  assert.ok(login(env, 'p@example.com'));
});

test('elimina: chi è stato eliminato può chiedere di nuovo l\'accesso', () => {
  const env = boot();
  ok(salva(env, { email: 'ex@example.com', ruolo: 'VIEWER' }));
  ok(call(env.ctx, 'utenti.elimina', { email: 'ex@example.com' }, env.token));
  ok(call(env.ctx, 'accesso.richiedi', { email: 'ex@example.com', nome: 'Ex Tecnico' }));
  assert.equal(ok(call(env.ctx, 'accesso.richieste', {}, env.token)).some(r => r.email === 'ex@example.com'), true);
});

test('permessi particolari: carica, modifica, tutti_documenti valgono subito sul server e si tolgono subito', () => {
  const env = boot();
  const e = eventi(env).find(x => x.titolo.startsWith('Cantelmo'));
  const file = { evento_id: e.id, sezione: 'scheda', nome: 'rider.pdf', mime: 'application/pdf', dati: Buffer.from('%PDF-1.4 x').toString('base64') };
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER' }));
  assegna(env, 'Cantelmo', 'v@example.com');
  const tok = login(env, 'v@example.com');
  assert.equal(call(env.ctx, 'allegati.carica', file, tok).error.code, 'FORBIDDEN');
  // carica
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', permessi_extra: ['carica'] }));
  ok(call(env.ctx, 'allegati.carica', file, tok));          // stessa sessione, nessun nuovo login
  const p = ok(call(env.ctx, 'utenti.list', {}, env.token)).find(u => u.email === 'v@example.com');
  assert.deepEqual(p.permessi_extra, ['carica']);
  // non dà altro: niente modifica di Plan, niente impostazioni, niente eventi
  assert.equal(call(env.ctx, 'produzione.assicura', { evento_id: e.id }, tok).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'utenti.list', {}, tok).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'eventi.create', { titolo: 'x', data: isoDay(2) }, tok).error.code, 'FORBIDDEN');
  // tolto: subito rifiutato
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', permessi_extra: [] }));
  assert.equal(call(env.ctx, 'allegati.carica', file, tok).error.code, 'FORBIDDEN');
  // modifica Plan e Material
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', permessi_extra: ['modifica'] }));
  const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: e.id }, tok));
  const doc = ok(call(env.ctx, 'documento.get', { produzione_id: pr.id, tipo: 'plan' }, tok));
  assert.ok(doc);
  assert.equal(call(env.ctx, 'allegati.carica', file, tok).error.code, 'FORBIDDEN', 'modifica non include il carico file');
});

test('permessi particolari: "vede tutti i documenti" apre documenti e file di ogni evento, ma non fa diventare Owner', () => {
  const env = boot();
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER' }));
  const tok = login(env, 'v@example.com');
  const e = eventi(env, tok).find(x => x.titolo.startsWith('Convegno'));
  assert.equal(e.accesso, false);
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', permessi_extra: ['tutti_documenti'] }));
  const aperto = eventi(env, tok).find(x => x.titolo.startsWith('Convegno'));
  assert.equal(aperto.accesso, true);
  assert.equal(ok(call(env.ctx, 'eventi.get', { id: e.id }, tok)).allegati !== null, true);
  // resta un Viewer: non scrive, non gestisce, non vede le proposte da confermare
  assert.equal(call(env.ctx, 'eventi.update', { id: e.id, note: 'x' }, tok).error.code, 'FORBIDDEN');
  assert.equal(call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: ADMIN }, tok).error.code, 'FORBIDDEN');
  assert.equal(aperto.da_confermare || 0, 0);
  assert.equal(call(env.ctx, 'utenti.list', {}, tok).error.code, 'FORBIDDEN');
  // il profilo lo dice al client
  const pr = ok(call(env.ctx, 'auth.me', {}, tok));
  assert.equal(pr.permessi.vedereTutto, true);
  assert.equal(pr.permessi.admin, false);
  // tolto: l'evento torna riservato
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', permessi_extra: [] }));
  assert.equal(eventi(env, tok).find(x => x.titolo.startsWith('Convegno')).accesso, false);
});

test('permessi particolari: valori non validi rifiutati, l\'Owner non ne ha, le modifiche sono registrate, senza campo restano come sono', () => {
  const env = boot();
  assert.equal(salva(env, { email: 'v@example.com', permessi_extra: ['admin'] }).error.code, 'INVALID');
  assert.equal(salva(env, { email: 'v@example.com', permessi_extra: 'carica' }).error.code, 'INVALID');
  assert.equal(call(env.ctx, 'utenti.save', { email: ADMIN, ruolo: 'OWNER', nome: 'A', permessi_extra: ['carica'] }, env.token).error.code, 'INVALID');
  assert.equal(elenco(env).some(u => u.email === 'v@example.com'), false, 'una richiesta rifiutata non crea nulla');
  ok(salva(env, { email: 'v@example.com', permessi_extra: ['modifica', 'carica', 'carica'] }));
  assert.deepEqual(elenco(env).find(u => u.email === 'v@example.com').permessi_extra, ['carica', 'modifica']);
  // salvare senza il campo non azzera
  ok(salva(env, { email: 'v@example.com', nome: 'Nuovo Nome' }));
  assert.deepEqual(elenco(env).find(u => u.email === 'v@example.com').permessi_extra, ['carica', 'modifica']);
  assert.ok(accessi(env).some(x => x.evento === 'permessi' && /carica file, modifica Plan e Material/.test(x.dettaglio)));
  // il cambio di ruolo non cancella le eccezioni, l'Owner vede 0 eccezioni
  assert.deepEqual(elenco(env).find(u => u.email === ADMIN).permessi_extra, []);
});

test('sessione persistente: dura 30 giorni, sopravvive a una nuova istanza del server, token alterato rifiutato; logout la chiude', () => {
  const env = boot();
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER' }));
  const tok = login(env, 'v@example.com');
  const s = rows(env, 'sessioni').find(x => x.email === 'v@example.com');
  const giorni = (new Date(s.scade) - new Date(s.creata)) / 86400000;
  assert.ok(giorni > 29.9 && giorni < 30.1, 'giorni: ' + giorni);
  // "ricaricare la pagina" / "riaprire il browser": cache del server svuotata, stesso token, stessa sessione
  for (let i = 0; i < 3; i++) { env.state.cache.clear(); ok(call(env.ctx, 'eventi.list', {}, tok)); }
  assert.equal(rows(env, 'sessioni').filter(x => x.email === 'v@example.com').length, 1, 'nessuna sessione duplicata');
  // il token non si lascia indovinare né modificare
  assert.equal(call(env.ctx, 'eventi.list', {}, tok.slice(0, -1) + (tok.endsWith('a') ? 'b' : 'a')).error.code, 'AUTH_REQUIRED');
  // il logout chiude davvero la sessione sul server
  ok(call(env.ctx, 'auth.logout', {}, tok));
  assert.equal(call(env.ctx, 'eventi.list', {}, tok).error.code, 'AUTH_REQUIRED');
  assert.equal(rows(env, 'sessioni').filter(x => x.email === 'v@example.com').length, 0);
});

test('migrazione: il setup aggiunge permessi_extra, eliminato, eliminato_il senza toccare gli utenti già presenti', () => {
  const env = boot();
  ok(salva(env, { email: 'v@example.com', nome: 'V', ruolo: 'VIEWER', scade_il: isoDay(10) }));
  const head = grezze(env, 'utenti')[0];
  for (const c of ['permessi_extra', 'eliminato', 'eliminato_il']) assert.ok(head.includes(c), c);
  assert.equal(head.indexOf('colore') < head.indexOf('permessi_extra'), true, 'colonne solo in fondo');
  const prima = JSON.stringify(rows(env, 'utenti'));
  env.ctx.setupProduzione();
  assert.equal(JSON.stringify(rows(env, 'utenti')), prima, 'setup ripetuto: nessuna riga cambia');
});
