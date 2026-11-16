/**
 * Test end-to-end: l'app vera nel browser parla con il backend vero,
 * che gira in Node con i servizi Google simulati.
 */
import { test, expect } from 'playwright/test';
import { loadBackend } from '../mocks/google.mjs';

const API = 'https://api.ctrl.test/exec';
const cspErrors = [];
test.afterEach(() => { expect(cspErrors, 'violazioni CSP').toEqual([]); cspErrors.length = 0; });
const ADMIN = 'admin@example.com';

function isoDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
}
function romeIso(day, hhmm) {
  for (const off of ['+01:00', '+02:00']) {
    const d = new Date(`${day}T${hhmm}:00${off}`);
    if (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) === hhmm) return d.toISOString();
  }
}

function calendar() {
  return [
    { id: 'a@google.com', title: 'Cantelmo: Maria Mazzotta', start: romeIso(isoDay(2), '21:00'), end: romeIso(isoDay(2), '23:30'), location: 'Officine Cantelmo, Lecce', description: 'Referente <b>Luca</b>', color: '6' },
    { id: 'b@google.com', title: 'Convegno Museo Castromediano', allDay: true, start: isoDay(5), end: isoDay(8), description: 'Roberto - 393 000 0000' },
    { id: 'c@google.com', title: 'Cantelmo: Swing night con un titolo molto lungo che deve andare a capo senza rompere la riga', allDay: true, start: isoDay(9), end: isoDay(10), location: 'Officine Cantelmo, Lecce' },
    { id: 'd@google.com', title: 'Evento passato', allDay: true, start: isoDay(-5), end: isoDay(-4) }
  ];
}

async function setup(page, { calendarEvents = calendar() } = {}) {
  await page.route(/script\.google(usercontent)?\.com/, (r) => r.abort()); // mai i server veri
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  env.failSalva = 0; // simula la rete che cade sui salvataggi della scheda
  await page.route(API, async (route) => {
    const body = route.request().postData();
    if (env.failSalva > 0 && JSON.parse(body).action === 'produzione.salva') { env.failSalva--; return route.abort('internetdisconnected'); }
    const out = JSON.parse(JSON.stringify(env.ctx.handleRequest(body)));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  return env;
}

async function login(page, env, email = ADMIN) {
  env.state.cache.clear();
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Invia codice' }).click();
  await expect(page.getByText('Codice inviato a ' + email)).toBeVisible();
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  await page.getByLabel('Codice di accesso').fill(code);
  await expect(page.getByRole('list')).toBeVisible();
}

async function noHorizontalScroll(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
}

test('accesso con codice, lista eventi dal Calendar, nessuno scroll orizzontale', async ({ page }, info) => {
  const env = await setup(page);
  await login(page, env);
  await expect(page.locator('.ev')).toHaveCount(3);
  await expect(page.getByText('Cantelmo: Maria Mazzotta')).toBeVisible();
  await expect(page.getByText('Evento passato')).toHaveCount(0);
  await page.getByRole('button', { name: 'Passati' }).click();
  await expect(page.getByText('Evento passato')).toBeVisible();
  await page.getByRole('button', { name: 'Prossimi' }).click();
  await page.getByLabel('Cerca').fill('castromediano');
  await expect(page.locator('.ev')).toHaveCount(1);
  await page.getByLabel('Cerca').fill('');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/lista-${info.project.name}.png`, fullPage: true });
});

test('codice sbagliato mostra l\'errore e i tentativi rimasti', async ({ page }) => {
  const env = await setup(page);
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN);
  await page.getByRole('button', { name: 'Invia codice' }).click();
  await page.getByLabel('Codice di accesso').fill('000000');
  await expect(page.getByText(/Codice errato\. Tentativi rimasti: 4/)).toBeVisible();
  void env;
});

test('dettaglio evento, note di produzione salvate davvero nel database', async ({ page }, info) => {
  const env = await setup(page);
  await login(page, env);
  await page.getByText('Cantelmo: Maria Mazzotta').click();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Maria Mazzotta' })).toBeVisible();
  await expect(page.getByText('Referente Luca')).toBeVisible();
  const stripe = await page.locator('.detail-head').evaluate(el => getComputedStyle(el, '::before').backgroundColor);
  expect(stripe).toBe('rgb(244, 81, 30)');
  await expect(page.locator('.detail-meta .mono')).toHaveText('21:00–23:30');
  await page.getByLabel('Note di produzione').fill('Carico alle 15, ingresso da via Libertini');
  await page.getByRole('button', { name: 'Salva note' }).click();
  await expect(page.getByText('Note salvate')).toBeVisible();
  const row = env.getSS(env.state.props.DB_ID).getSheetByName('eventi').rows().find(r => r[3] === 'Cantelmo: Maria Mazzotta');
  expect(row[14]).toBe('Carico alle 15, ingresso da via Libertini');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/evento-${info.project.name}.png`, fullPage: true });
});

test('nuovo evento manuale: validazione, creazione, modifica', async ({ page }, info) => {
  const env = await setup(page);
  await login(page, env);
  if (info.project.name === 'mobile') await page.locator('.fab').click();
  else await page.getByRole('button', { name: 'Nuovo evento' }).first().click();
  const dlg = page.locator('dialog.sheet');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Crea evento' }).click();
  await expect(dlg.getByText('Il titolo è obbligatorio.')).toBeVisible();
  await dlg.getByLabel('Titolo *').fill('Sopralluogo Castello');
  await dlg.getByLabel('Data *').fill(isoDay(3));
  await dlg.getByLabel('Ora inizio').fill('12:00');
  await dlg.getByLabel('Luogo').fill('Castello Carlo V');
  await page.screenshot({ path: `test-results/form-${info.project.name}.png` });
  await dlg.getByRole('button', { name: 'Crea evento' }).click();
  await expect(page.getByRole('heading', { name: 'Sopralluogo Castello' })).toBeVisible();
  await page.getByRole('button', { name: 'Modifica' }).click();
  await page.locator('dialog.sheet').getByLabel('Luogo').fill('Castello Carlo V, Lecce');
  await page.locator('dialog.sheet').getByRole('button', { name: 'Salva' }).click();
  await expect(page.locator('.detail-meta')).toContainText('Castello Carlo V, Lecce');
  const rows = env.getSS(env.state.props.DB_ID).getSheetByName('eventi').rows().filter(r => r[3] === 'Sopralluogo Castello');
  expect(rows.length).toBe(1);
  expect(rows[0][1]).toBe('manuale');
  expect(rows[0][6]).toBe('12:00');
});

test('impostazioni: utenti, liste a tendina, sincronizzazione', async ({ page }, info) => {
  const env = await setup(page);
  await login(page, env);
  await page.getByRole('link', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await page.getByRole('button', { name: 'Aggiungi utente' }).click();
  const dlg = page.locator('dialog.sheet');
  await dlg.getByLabel('Email').fill('manuel@example.com');
  await dlg.getByLabel('Nome').fill('Manuel');
  await dlg.getByLabel('Ruolo').selectOption('COLLABORATORE');
  await dlg.getByText('Può caricare file').click();
  await dlg.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('manuel@example.com')).toBeVisible();
  await expect(page.getByText('Carica file')).toBeVisible();

  const aree = page.locator('section.card', { hasText: 'Aree del materiale' });
  await aree.getByRole('button', { name: 'Aggiungi valore' }).click();
  await aree.locator('.lst .it input').last().fill('Scenografia');
  await aree.getByRole('button', { name: 'Togli Rigging' }).click();
  await aree.getByRole('button', { name: 'Salva' }).click();
  await expect(aree.getByText('Salvato')).toBeVisible();
  const saved = env.ctx.Settings.lista('aree');
  expect(JSON.parse(JSON.stringify(saved))).toEqual(['Audio', 'Luci', 'Video', 'Backline', 'Venue', 'Altro', 'Scenografia']);

  env.state.calendar.events.push({ id: 'z@google.com', title: 'Nuovo dal Calendar', allDay: true, start: isoDay(12), end: isoDay(13) });
  await page.getByRole('button', { name: 'Sincronizza ora' }).click();
  await expect(page.getByText(/1 nuovi/).first()).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/impostazioni-${info.project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Eventi', exact: true }).click();
  await expect(page.getByText('Nuovo dal Calendar')).toBeVisible();
});

test('utente in sola lettura: niente creazione, niente impostazioni, note non modificabili', async ({ page }) => {
  const env = await setup(page);
  const admin = env.ctx.handleRequest(JSON.stringify({ action: 'auth.requestCode', payload: { email: ADMIN } }));
  void admin;
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  const tok = env.ctx.handleRequest(JSON.stringify({ action: 'auth.verifyCode', payload: { email: ADMIN, code } })).data.token;
  env.ctx.handleRequest(JSON.stringify({ action: 'utenti.save', token: tok, payload: { email: 'tecnico@example.com', nome: 'Tecnico', ruolo: 'LETTURA' } }));
  await login(page, env, 'tecnico@example.com');
  await expect(page.locator('.fab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuovo evento' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Impostazioni' })).toHaveCount(0);
  await page.getByText('Convegno Museo Castromediano').click();
  await expect(page.getByLabel('Note di produzione')).toHaveCount(0);
  await expect(page.getByText('Nessuna nota.')).toBeVisible();
  await page.goto('/#/impostazioni');
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toHaveCount(0);
});

test('sessione revocata: si torna all\'accesso', async ({ page }) => {
  const env = await setup(page);
  await login(page, env);
  env.getSS(env.state.props.DB_ID).getSheetByName('sessioni').data.splice(1);
  await page.getByText('Cantelmo: Maria Mazzotta').click();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('API non configurata: messaggio chiaro', async ({ page }) => {
  await page.addInitScript(() => { window.__CTRL_API__ = ''; });
  await page.goto('/');
  await expect(page.getByText(/non è ancora collegato al server/)).toBeVisible();
});

test('tema scuro leggibile', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const env = await setup(page);
  await login(page, env);
  await page.getByText('Cantelmo: Maria Mazzotta').click();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Maria Mazzotta' })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(12, 14, 17)');
  await page.screenshot({ path: `test-results/scuro-${info.project.name}.png`, fullPage: true });
});

// ---------------- File allegati ----------------

function tokenFor(env, email) {
  env.state.cache.clear();
  env.ctx.handleRequest(JSON.stringify({ action: 'auth.requestCode', payload: { email } }));
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return env.ctx.handleRequest(JSON.stringify({ action: 'auth.verifyCode', payload: { email, code } })).data.token;
}
const apiCall = (env, token, action, payload) => env.ctx.handleRequest(JSON.stringify({ action, token, payload }));

async function openEvent(page, env, title = 'Cantelmo: Maria Mazzotta') {
  await login(page, env);
  await page.getByText(title).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('file allegati: carico un rider, scarico identico, rifiuto oltre 20 MB, tolgo nel cestino; indicatore in lista', async ({ page }, info) => {
  const env = await setup(page);
  await openEvent(page, env);
  const box = page.locator('#files-scheda');
  const content = Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 256));
  await box.getByLabel('Allega file a Scheda tecnica e rider').setInputFiles({ name: 'rider band.pdf', mimeType: 'application/pdf', buffer: content });
  await expect(page.getByText('File caricato')).toBeVisible();
  await expect(box.getByText('rider band.pdf')).toBeVisible();
  const driveFile = [...env.state.drive.files.values()].find(f => f.name === 'rider band.pdf');
  expect(Buffer.from(driveFile.bytes.map(b => (b + 256) % 256)).equals(content)).toBe(true);
  const [dl] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: /Scarica rider band\.pdf/ }).click()]);
  expect(dl.suggestedFilename()).toBe('rider band.pdf');
  const fs = await import('node:fs');
  expect(fs.readFileSync(await dl.path()).equals(content)).toBe(true);
  await box.getByLabel('Allega file a Scheda tecnica e rider').setInputFiles({ name: 'video.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(21 * 1024 * 1024) });
  await expect(box.getByText('video.mov: troppo grande (max 20 MB)')).toBeVisible();
  if (info.project.name === 'desktop') await expect(page.locator('.ev', { hasText: 'Cantelmo: Maria Mazzotta' }).locator('.ind .scheda.on')).toHaveCount(1);
  await box.getByRole('button', { name: 'Togli rider band.pdf' }).click();
  await box.getByRole('button', { name: 'Conferma: togli rider band.pdf' }).click();
  await expect(page.getByText('File spostato nel cestino di Drive')).toBeVisible();
  await expect(box.getByText('rider band.pdf')).toHaveCount(0);
  expect(driveFile.trashed).toBe(true);
  await noHorizontalScroll(page);
});

// ---------------- Tappa 1: scheda di produzione ----------------

test('scheda di produzione: creo dall\'evento, struttura e squadra si salvano da sole e restano dopo il ricaricamento', async ({ page }, info) => {
  const env = await setup(page);
  const adm = tokenFor(env, ADMIN);
  // una persona già in rubrica (da un altro evento)
  const altra = apiCall(env, adm, 'produzione.crea', { evento_id: apiCall(env, adm, 'eventi.list', {}).data.find(e => e.titolo.startsWith('Convegno')).id }).data;
  apiCall(env, adm, 'produzione.salva', { id: altra.id, ops: [{ tipo: 'persona', azione: 'crea', id: 'per_rubrica000001', campi: { nome: 'Federico Rizzello', ruolo: 'Tecnico luci', telefono: '+39 333 111 2222' } }] });

  await openEvent(page, env);
  await page.getByRole('button', { name: 'Crea scheda di produzione' }).click();
  await expect(page.getByRole('textbox', { name: 'Nome della scheda di produzione' })).toHaveValue('Cantelmo: Maria Mazzotta');
  await expect(page.locator('.tile', { hasText: 'Struttura' })).toContainText('1 giornata · 1 spazio');
  await expect(page.locator('.avvisi')).toContainText('Squadra vuota');
  await page.screenshot({ path: `test-results/prod-panoramica-${info.project.name}.png`, fullPage: true });

  // titolo
  await page.getByRole('textbox', { name: 'Nome della scheda di produzione' }).fill('Maria Mazzotta · Cantelmo');
  // struttura
  await page.locator('.prod-nav').getByRole('link', { name: /Struttura/ }).click();
  await page.getByLabel('Data della nuova giornata').fill(isoDay(1));
  await page.getByRole('button', { name: 'Aggiungi giornata' }).click();
  await page.getByLabel('Etichetta del ' + isoDay(1)).fill('Montaggio');
  await page.getByLabel('Nome del nuovo spazio').fill('Palco principale');
  await page.getByRole('button', { name: 'Aggiungi spazio' }).click();
  const palco = page.locator('.lrow.spa').nth(1);
  await palco.getByLabel('Tipo di spazio').selectOption('palco');
  await palco.getByLabel('Note dello spazio').fill('Pedane 6x4, corrente 32A');
  await page.getByRole('button', { name: 'Sposta su Palco principale' }).click();
  await expect(page.locator('.lrow.spa').first().getByLabel('Nome dello spazio')).toHaveValue('Palco principale');
  // nome vuoto: segnalato e non inviato
  await page.locator('.lrow.spa').nth(1).getByLabel('Nome dello spazio').fill('');
  await expect(page.locator('.lrow.spa').nth(1).getByLabel('Nome dello spazio')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('.lrow.spa').nth(1).getByLabel('Nome dello spazio').fill('Officine Cantelmo');
  await expect(page.locator('.save-ind')).toHaveText(/Salvato alle/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/prod-struttura-${info.project.name}.png`, fullPage: true });

  // persone: una nuova e una dalla rubrica
  await page.locator('.prod-nav').getByRole('link', { name: /Persone/ }).click();
  const cerca = page.getByLabel('Cerca o aggiungi una persona');
  await cerca.fill('Manuel');
  await page.getByRole('option', { name: 'Nuova persona «Manuel»' }).click();
  await page.getByLabel('Ruolo', { exact: true }).fill('Fonico');
  await page.getByLabel('Telefono', { exact: true }).fill('+39 333 000 0000');
  await page.getByLabel('Email', { exact: true }).fill('non-email');
  await page.getByRole('button', { name: 'Aggiungi alla squadra' }).click();
  await expect(page.getByText('Email non valida.')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('manuel@example.com');
  await page.getByRole('button', { name: 'Aggiungi alla squadra' }).click();
  await expect(page.getByText('Manuel aggiunto alla squadra')).toBeVisible();
  await cerca.fill('luci');
  await page.getByRole('option', { name: /Federico Rizzello/ }).click();
  await page.getByLabel('Spazio di Federico Rizzello').selectOption({ label: 'Palco principale' });
  await page.getByLabel('Ruolo di Manuel in questo evento').fill('Fonico di sala');
  await expect(page.locator('.save-ind')).toHaveText(/Salvato alle/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/prod-persone-${info.project.name}.png`, fullPage: true });

  // nel database
  const db = env.getSS(env.state.props.DB_ID);
  const pr = db.getSheetByName('progetti').rows().find(r => r[1] === 'Maria Mazzotta · Cantelmo');
  expect(pr).toBeTruthy();
  const pid = pr[0];
  expect(db.getSheetByName('giornate').rows().filter(r => r[1] === pid).map(r => [r[2], r[3]]).sort()).toEqual([[isoDay(1), 'Montaggio'], [isoDay(2), '']]);
  const spazi = db.getSheetByName('location').rows().filter(r => r[1] === pid);
  expect(spazi.find(r => r[2] === 'Palco principale')[6]).toBe('palco');
  const sq = db.getSheetByName('squadra').rows().filter(r => r[1] === pid);
  expect(sq.length).toBe(2);

  // ricarico: tutto è ancora lì
  await page.reload();
  await expect(page.getByText('Manuel', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ruolo di Manuel in questo evento')).toHaveValue('Fonico di sala');
  await expect(page.getByLabel('Spazio di Federico Rizzello')).toHaveValue(spazi.find(r => r[2] === 'Palco principale')[0]);
  await page.locator('.prod-nav').getByRole('link', { name: /Panoramica/ }).click();
  await expect(page.locator('.tile', { hasText: 'Persone' })).toContainText('2 in squadra');
  await expect(page.getByText('Nessun avviso.')).toBeVisible();
  // dal dettaglio evento si vede il riepilogo
  await page.getByRole('link', { name: 'Evento' }).click();
  await expect(page.locator('.prod-card')).toContainText('2 giornate, 2 spazi');
});

test('festival: aggiungo un secondo evento alla scheda e le giornate si aggiornano', async ({ page }) => {
  const env = await setup(page);
  await openEvent(page, env, 'Convegno Museo Castromediano');
  await page.getByRole('button', { name: 'Crea scheda di produzione' }).click();
  await expect(page.locator('.tile', { hasText: 'Struttura' })).toContainText('3 giornate');
  await page.getByLabel('Cerca un evento da aggiungere').fill('swing');
  await page.getByRole('option', { name: /Swing night/ }).click();
  await expect(page.getByText('Evento aggiunto: giornate aggiornate')).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Struttura' })).toContainText('4 giornate');
  await expect(page.getByText('Scheda di produzione · festival')).toBeVisible();
  await expect(page.locator('.ev-link')).toHaveCount(2);
  await page.getByRole('button', { name: /Togli Cantelmo: Swing night/ }).click();
  await page.getByRole('button', { name: /Conferma: Togli Cantelmo: Swing night/ }).click();
  await expect(page.locator('.ev-link')).toHaveCount(1);
});

test('rete che cade durante il salvataggio: riprova da solo, nessun dato perso né duplicato', async ({ page }) => {
  const env = await setup(page);
  await openEvent(page, env);
  await page.getByRole('button', { name: 'Crea scheda di produzione' }).click();
  await page.locator('.prod-nav').getByRole('link', { name: /Struttura/ }).click();
  env.failSalva = 2;
  await page.getByLabel('Nome del nuovo spazio').fill('Camerino');
  await page.getByRole('button', { name: 'Aggiungi spazio' }).click();
  await expect(page.locator('.save-ind')).toHaveText('Rete assente, riprovo…');
  await page.locator('.lrow.spa').nth(1).getByLabel('Note dello spazio').fill('Secondo piano');
  await expect(page.locator('.save-ind')).toHaveText(/Salvato alle/, { timeout: 20000 });
  const rows = env.getSS(env.state.props.DB_ID).getSheetByName('location').rows().filter(r => r[2] === 'Camerino');
  expect(rows.length).toBe(1);
  expect(rows[0][4]).toBe('Secondo piano');
});

test('sola lettura: vede scheda e file, non crea, non modifica, non carica', async ({ page }) => {
  const env = await setup(page);
  const adm = tokenFor(env, ADMIN);
  const evId = apiCall(env, adm, 'eventi.list', {}).data.find(e => e.titolo === 'Convegno Museo Castromediano').id;
  const p = apiCall(env, adm, 'produzione.crea', { evento_id: evId }).data;
  apiCall(env, adm, 'produzione.salva', { id: p.id, ops: [
    { tipo: 'persona', azione: 'crea', id: 'per_letturatest01', campi: { nome: 'Cesare', telefono: '340 000' } },
    { tipo: 'squadra', azione: 'crea', id: 'sq_letturatest001', campi: { persona_id: 'per_letturatest01', ruolo: 'Direttore di produzione' } }] });
  apiCall(env, adm, 'allegati.carica', { evento_id: evId, sezione: 'piano', nome: 'piano.pdf', mime: 'application/pdf', dati: Buffer.from('PIANO').toString('base64') });
  apiCall(env, adm, 'utenti.save', { email: 'tecnico@example.com', nome: 'Tecnico', ruolo: 'LETTURA' });
  await login(page, env, 'tecnico@example.com');
  await page.getByText('Convegno Museo Castromediano').click();
  await expect(page.getByText('Allega file')).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica piano\.pdf/ }).click()]);
  const fs = await import('node:fs');
  expect(fs.readFileSync(await dl.path()).toString()).toBe('PIANO');
  await page.getByRole('link', { name: 'Apri scheda' }).click();
  await expect(page.getByRole('heading', { name: 'Convegno Museo Castromediano' })).toBeVisible();
  await expect(page.locator('main.prod input, main.prod select, main.prod textarea')).toHaveCount(0);
  await page.locator('.prod-nav').getByRole('link', { name: /Persone/ }).click();
  await expect(page.getByText('Direttore di produzione')).toBeVisible();
  await expect(page.locator('main.prod input, main.prod select, main.prod textarea')).toHaveCount(0);
});
