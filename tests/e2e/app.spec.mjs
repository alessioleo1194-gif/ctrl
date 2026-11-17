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
    const azione = JSON.parse(body).action;
    if (env.failSalva > 0 && azione === 'documento.salva') { env.failSalva--; return route.abort('internetdisconnected'); }
    if (env.primaDelSalvataggio && azione === 'documento.salva') { const f = env.primaDelSalvataggio; env.primaDelSalvataggio = null; f(); }
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

// ---------------- Production Plan e Material List: fogli di lavoro ----------------

const cella = (page, foglio, colonna, riga) => page.getByLabel(`${foglio} · ${colonna} · riga ${riga}`, { exact: true });
const incolla = (page, label, tsv) => page.getByLabel(label, { exact: true }).evaluate((el, t) => {
  const dt = new DataTransfer(); dt.setData('text/plain', t); el.focus();
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, tsv);
const salvato = (page) => expect(page.locator('.save-ind')).toHaveText(/Salvato alle|Tutto salvato/, { timeout: 15000 });
const righeDoc = (env, tipo) => {
  const ss = env.getSS(env.state.props.DB_ID);
  const doc = ss.getSheetByName('documenti').rows().slice(1).filter(r => r[2] === tipo).pop();   // l'ultimo creato
  if (!doc) return null;
  const parti = ss.getSheetByName('documenti_parti').rows().slice(1).filter(r => r[1] === doc[0]).sort((a, b) => a[2] - b[2]);
  return JSON.parse(parti.map(r => r[3]).join(''));
};
const apriPlan = async (page, env, titolo = 'Cantelmo: Maria Mazzotta') => {
  await openEvent(page, env, titolo);
  await page.getByRole('button', { name: /Production Plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Production Plan' })).toBeVisible();
  await expect(page.locator('.programma tbody tr')).toHaveCount(49);
};

const FRISELL = '16:45-18:30\tSoundcheck\tMain Stage\tBill Frisell Trio\n19:30\tDoors Open\tEntrance\t\n21:00\tShow Start\tMain Stage\t90 min\n22:30\tShow End\t\t';

test('Production Plan: si apre subito come foglio pronto, senza modali né pulsanti "aggiungi"', async ({ page }, info) => {
  const env = await setup(page);
  await apriPlan(page, env);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /aggiungi/i })).toHaveCount(0);
  const dl = page.locator('dl.intestazione');
  await expect(dl).toContainText('Cantelmo: Maria Mazzotta');
  await expect(dl).toContainText('Officine Cantelmo');
  await expect(dl).toContainText('Lecce');
  await expect(page.locator('.griglia').first().locator('tbody tr')).toHaveCount(8);                 // crew già pronta
  expect(await cella(page, 'Schedule', 'Time', 1).inputValue()).toBe('00:00');
  expect(await cella(page, 'Schedule', 'Time', 49).inputValue()).toBe('24:00');
  expect(await cella(page, 'Schedule', 'Time', 4).inputValue()).toBe('01:30');
  await expect(cella(page, 'Schedule', 'Section', 1)).toHaveAttribute('placeholder', 'Pre Show');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/plan-vuoto-${info.project.name}.png` });
  expect(righeDoc(env, 'plan')).toBe(null);   // niente viene salvato finché non scrivi
});

test('Production Plan: compilo solo con la tastiera (menu attività, Tab, Invio), si salva da solo e resta dopo il ricaricamento', async ({ page }) => {
  const env = await setup(page);
  await apriPlan(page, env);
  await cella(page, 'Crew', 'Name', 1).click();
  await page.keyboard.type('Mario Rossi');
  await page.keyboard.press('Tab'); await page.keyboard.type('FOH');
  await page.keyboard.press('Tab'); await page.keyboard.type('393 111');
  await page.keyboard.press('Tab'); await page.keyboard.type('mario@x.it');
  await cella(page, 'Schedule', 'Time', 17).click();                                               // 08:00
  await page.keyboard.type('930');
  await page.keyboard.press('Tab');
  await page.keyboard.type('sound');
  await expect(page.getByRole('option', { name: 'Soundcheck' })).toBeVisible();
  await page.keyboard.press('Tab');                                                                 // sceglie dal menu e va a Location
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('Soundcheck');
  await page.keyboard.type('Main Stage');
  await page.keyboard.press('Tab'); await page.keyboard.type('con il trio');
  await page.keyboard.press('Enter');                                                               // scende di riga, stessa colonna
  await expect(cella(page, 'Schedule', 'Details / Notes', 18)).toBeFocused();
  expect(await cella(page, 'Schedule', 'Time', 17).inputValue()).toBe('09:30');                     // normalizzato
  await salvato(page);
  await page.reload();
  await expect(page.locator('.programma tbody tr')).toHaveCount(49);
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('Soundcheck');
  expect(await cella(page, 'Schedule', 'Location', 17).inputValue()).toBe('Main Stage');
  expect(await cella(page, 'Crew', 'Role', 1).inputValue()).toBe('FOH');
  const j = righeDoc(env, 'plan');
  expect(j.crew).toHaveLength(1);
  expect(j.giorni[0].righe).toHaveLength(49);
});

test('Production Plan: incollo un blocco da Excel in un colpo; Show Start porta in Show; documento ordinato per orario', async ({ page }, info) => {
  const env = await setup(page);
  await apriPlan(page, env);
  await incolla(page, 'Schedule · Time · riga 5', '10:00\tLoad-out\tBack\tfinale\n');   // riga scritta in alto con un orario più tardi: il documento la riordina
  await incolla(page, 'Schedule · Time · riga 17', FRISELL);
  expect(await cella(page, 'Schedule', 'Time', 17).inputValue()).toBe('16:45 – 18:30');
  expect(await cella(page, 'Schedule', 'Activity', 19).inputValue()).toBe('Show Start');
  await expect(cella(page, 'Schedule', 'Section', 19)).toHaveValue('Show');
  await expect(cella(page, 'Schedule', 'Section', 20)).toHaveAttribute('placeholder', 'Show');   // eredita
  await page.getByRole('button', { name: 'Generate PdP' }).click();
  const doc = page.locator('article.doc');
  await expect(doc.getByRole('heading', { name: 'Production Plan' })).toBeVisible();
  await expect(doc).toContainText('Officine Cantelmo');
  const bande = await doc.locator('.doc-banda').allTextContents();
  expect(bande).toEqual(['PRE SHOW', 'SHOW']);
  const ore = await doc.locator('table.prog tbody tr:not(.doc-banda) td:first-child').allTextContents();
  expect(ore).toEqual(['10:00', '16:45 – 18:30', '19:30', '21:00', '22:30']);   // 10:00 era sopra, ma il documento è ordinato
  await expect(doc.locator('table.prog')).toContainText('Bill Frisell Trio');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/plan-documento-${info.project.name}.png`, fullPage: true });
  await doc.waitFor();
  // lingua
  await page.getByLabel('Language').selectOption('it');
  await expect(doc.getByRole('heading', { name: 'Piano di produzione' })).toBeVisible();
  await page.getByLabel('Language').selectOption('en');
  // testo copiato
  await page.getByRole('button', { name: 'Copy Text' }).click();
  await expect(page.locator('#toast')).toHaveText(/Testo copiato|Copia non riuscita/);
  // PDF scaricato con i dati veri
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(dl.suggestedFilename()).toBe(`Production Plan - Cantelmo Maria Mazzotta - ${isoDay(2)}.pdf`);
  const fs = await import('node:fs');
  fs.copyFileSync(await dl.path(), `test-results/production-plan-${info.project.name}.pdf`);
  const pdf = fs.readFileSync(await dl.path()).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  for (const t of ['Production Plan', 'Soundcheck', 'Bill Frisell Trio', 'Officine Cantelmo', 'PRE SHOW', 'Show Start']) expect(pdf, t).toContain(t);
  // in stampa si vede solo il documento
  await page.emulateMedia({ media: 'print' });
  await expect(doc).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  // chiudo e torno al foglio con i dati
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('Soundcheck');
});

test('Production Plan: ordina per orario, inserisci e togli righe, annulla, copia di più celle', async ({ page }) => {
  const env = await setup(page);
  await apriPlan(page, env);
  await cella(page, 'Schedule', 'Activity', 17).fill('Setup');
  await cella(page, 'Schedule', 'Activity', 18).fill('Soundcheck');
  await cella(page, 'Schedule', 'Time', 17).fill('1600');
  await cella(page, 'Schedule', 'Time', 18).fill('1000');
  await cella(page, 'Schedule', 'Time', 18).blur();
  await page.getByRole('button', { name: 'Sort by time' }).click();
  const ordinate = await page.locator('.programma tbody tr').evaluateAll(rs => rs.map(r => r.querySelector('input[aria-label*="Activity"]').value).filter(Boolean));
  expect(ordinate).toEqual(['Soundcheck', 'Setup']);
  // inserisci riga sotto con Ctrl+Invio, poi eliminala con Ctrl+Canc
  await cella(page, 'Schedule', 'Activity', 10).click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.programma tbody tr')).toHaveCount(50);
  await page.keyboard.press('Control+Delete');
  await expect(page.locator('.programma tbody tr')).toHaveCount(49);
  // annulla: scrivo, annullo
  await cella(page, 'Schedule', 'Details / Notes', 5).click();
  await page.keyboard.type('prova');
  await page.keyboard.press('Control+z');
  expect(await cella(page, 'Schedule', 'Details / Notes', 5).inputValue()).toBe('');
  // selezione con Maiusc+freccia e copia come testo tabulato
  await cella(page, 'Schedule', 'Time', 3).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  const copiato = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  expect(copiato).toBe('01:00\t\n01:30\t');
  await page.keyboard.press('Delete');                                                     // più celle: le svuota
  expect(await cella(page, 'Schedule', 'Time', 3).inputValue()).toBe('');
  await page.keyboard.press('Control+z');
  expect(await cella(page, 'Schedule', 'Time', 3).inputValue()).toBe('01:00');
});

test('Production Plan: più giornate, una scheda per tutto il festival, due eventi condividono lo stesso foglio', async ({ page }) => {
  const env = await setup(page);
  await openEvent(page, env, 'Convegno Museo Castromediano');
  await page.getByRole('button', { name: /Production Plan/ }).click();
  await expect(page.locator('.giorni .seg-b')).toHaveCount(3);
  await cella(page, 'Schedule', 'Activity', 17).fill('Registrazione');
  await page.locator('.giorni .seg-b').nth(1).click();
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('');
  await cella(page, 'Schedule', 'Activity', 17).fill('Plenaria');
  await salvato(page);
  await page.getByRole('link', { name: 'Event', exact: true }).click();
  await page.getByText('Festival: condividi con altri eventi').click();
  await page.getByLabel('Collega un altro evento').selectOption({ label: isoDay(2) + ' · Cantelmo: Maria Mazzotta' });
  await expect(page.getByText(/Condivisi con:/)).toBeVisible();
  const j = righeDoc(env, 'plan');
  expect(j.giorni.map(g => g.righe.find(r => r.att)?.att)).toEqual(['Registrazione', 'Plenaria', undefined]);   // il documento nuovo ha solo le 3 giornate del convegno
  // dall'altro evento si apre lo stesso foglio
  await page.goto('/#/');
  await page.getByText('Cantelmo: Maria Mazzotta').first().click();
  await page.getByRole('link', { name: /Production Plan/ }).click();
  await expect(page.locator('dl.intestazione')).toContainText('Convegno Museo Castromediano');
  await expect(page.locator('.giorni .seg-b')).toHaveCount(4);                       // la data del nuovo evento si è aggiunta
  await page.locator('.giorni .seg-b').nth(1).click();
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('Registrazione');
});

test('Production Plan: la crew suggerisce persone già usate in altre produzioni e compila ruolo e contatti', async ({ page }) => {
  const env = await setup(page);
  const adm = tokenFor(env, ADMIN);
  const lista = apiCall(env, adm, 'eventi.list', {}).data;
  const a = apiCall(env, adm, 'produzione.assicura', { evento_id: lista.find(e => e.titolo.startsWith('Convegno')).id }).data;
  apiCall(env, adm, 'documento.salva', { produzione_id: a.id, tipo: 'plan', versione: '0', dati: { crew: [{ id: 'c1', nome: 'Cesare Liaci', ruolo: 'Direttore di produzione', telefono: '340 000 0000', email: 'c@x.it' }], giorni: [] } });
  await apriPlan(page, env);
  await cella(page, 'Crew', 'Name', 1).click();
  await page.keyboard.type('ces');
  await expect(page.getByRole('option', { name: /Cesare Liaci/ })).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await cella(page, 'Crew', 'Name', 1).inputValue()).toBe('Cesare Liaci');
  expect(await cella(page, 'Crew', 'Role', 1).inputValue()).toBe('Direttore di produzione');
  expect(await cella(page, 'Crew', 'Phone', 1).inputValue()).toBe('340 000 0000');
  // incollo 10 nominativi da Excel: la tabella cresce da sola
  const tsv = Array.from({ length: 10 }, (_, i) => `Tecnico ${i + 1}\tFonico\t333 00${i}\tt${i}@x.it`).join('\n');
  await incolla(page, 'Crew · Name · riga 2', tsv);
  await expect(page.locator('.griglia').first().locator('tbody tr')).toHaveCount(12);
  expect(await cella(page, 'Crew', 'Email', 11).inputValue()).toBe('t9@x.it');
});

test('salvataggio: un altro utente salva nel frattempo, le due modifiche si uniscono senza perdere nulla', async ({ page }) => {
  const env = await setup(page);
  await apriPlan(page, env);
  await cella(page, 'Schedule', 'Activity', 17).fill('Mia attività');
  const adm = tokenFor(env, ADMIN);
  const prId = page.url().match(/#\/p\/([\w-]+)/)[1];
  env.primaDelSalvataggio = () => {
    const cur = apiCall(env, adm, 'documento.get', { produzione_id: prId, tipo: 'plan' }).data;
    const dati = cur.dati || { crew: [], giorni: [] };
    dati.crew = [{ id: 'c_altro', nome: 'Altra persona', ruolo: 'Stage', telefono: '', email: '' }];
    apiCall(env, adm, 'documento.salva', { produzione_id: prId, tipo: 'plan', versione: cur.versione, dati });
  };
  await salvato(page);
  await expect.poll(() => (righeDoc(env, 'plan').giorni[0].righe.find(r => r.att) || {}).att).toBe('Mia attività');
  const j = righeDoc(env, 'plan');
  expect(j.crew.map(c => c.nome)).toEqual(['Altra persona']);
  await expect(cella(page, 'Crew', 'Name', 1)).toHaveValue('Altra persona');   // l'unione è tornata sullo schermo
  expect(await cella(page, 'Schedule', 'Activity', 17).inputValue()).toBe('Mia attività');
});

test('rete che cade durante il salvataggio: riprova da solo, nessun dato perso né duplicato', async ({ page }) => {
  const env = await setup(page);
  await apriPlan(page, env);
  env.failSalva = 2;
  await cella(page, 'Schedule', 'Activity', 17).fill('Soundcheck');
  await expect(page.locator('.save-ind')).toHaveText('Rete assente, riprovo…', { timeout: 10000 });
  await expect(page.locator('.save-ind')).toHaveText(/Salvato alle/, { timeout: 25000 });
  const j = righeDoc(env, 'plan');
  expect(j.giorni[0].righe.filter(r => r.att === 'Soundcheck')).toHaveLength(1);
  expect(env.getSS(env.state.props.DB_ID).getSheetByName('documenti').rows().length).toBe(2);   // intestazione + un solo documento
});

test('sola lettura: vede i fogli e genera il documento, ma non può scrivere né salvare', async ({ page }) => {
  const env = await setup(page);
  const adm = tokenFor(env, ADMIN);
  const evId = apiCall(env, adm, 'eventi.list', {}).data.find(e => e.titolo === 'Cantelmo: Maria Mazzotta').id;
  const p = apiCall(env, adm, 'produzione.assicura', { evento_id: evId }).data;
  apiCall(env, adm, 'documento.salva', { produzione_id: p.id, tipo: 'plan', versione: '0', dati: { crew: [], giorni: [{ id: 'g1', data: isoDay(2), righe: [{ id: 'r1', sez: '', ora: '18:00', att: 'Doors Open', loc: '', note: '' }] }] } });
  apiCall(env, adm, 'utenti.save', { email: 'tecnico@example.com', nome: 'Tecnico', ruolo: 'LETTURA' });
  await login(page, env, 'tecnico@example.com');
  await page.getByText('Cantelmo: Maria Mazzotta').click();
  await page.getByRole('link', { name: /Production Plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Production Plan' })).toBeVisible();
  await expect(page.locator('.griglia input:not([readonly])')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await expect(page.locator('.save-ind')).toHaveText('Sola lettura');
  await page.getByRole('button', { name: 'Generate PdP' }).click();
  await expect(page.locator('article.doc')).toContainText('Doors Open');
  const r = apiCall(env, tokenFor(env, 'tecnico@example.com'), 'documento.salva', { produzione_id: p.id, tipo: 'plan', versione: '1', dati: { crew: [], giorni: [] } });
  expect(r.ok).toBe(false);
});

// ---------------- Material List ----------------

const apriMateriali = async (page, env, titolo = 'Cantelmo: Maria Mazzotta') => {
  await openEvent(page, env, titolo);
  await page.getByRole('button', { name: /Material List/ }).click();
  await expect(page.getByRole('heading', { name: 'Material List' })).toBeVisible();
};

test('Material List: foglio già pronto, scrivo location e voci, incollo da Excel, duplico, documento e PDF', async ({ page }, info) => {
  const env = await setup(page);
  await apriMateriali(page, env);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /aggiungi/i })).toHaveCount(0);
  await expect(page.locator('.sez')).toHaveCount(2);                                   // una location già pronta + "nuova location"
  await expect(page.locator('.griglia tbody tr')).toHaveCount(5);
  // nome della location e prime righe, solo tastiera
  await page.getByLabel('Location name').first().fill('MAIN STAGE');
  await page.getByLabel('Location · Item · riga 1').click();
  await page.keyboard.type('Microphone Stands'); await page.keyboard.press('Tab');
  await page.keyboard.type('12'); await page.keyboard.press('Tab');
  await page.keyboard.type('Boom'); await page.keyboard.press('Enter');
  // blocco da Excel (3 righe x 3 colonne) dalla riga 2
  await incolla(page, 'Location · Item · riga 2', 'XLR Cables\t20\t10 m\nDI Box\t4\tActive\nPower Strips\t6\t');
  expect(await page.getByLabel('Location · Notes · riga 3').inputValue()).toBe('Active');
  // la tabella cresce da sola: sempre una riga libera in fondo
  await expect(page.locator('.griglia tbody tr')).toHaveCount(5);
  await incolla(page, 'Location · Item · riga 5', 'Cavo 1\t1\t\nCavo 2\t1\t');
  await expect(page.locator('.griglia tbody tr')).toHaveCount(7);
  // nuova location scrivendo il nome
  await page.getByLabel('New location name').fill('FOH');
  await page.getByLabel('New location name').press('Enter');
  await expect(page.locator('.sez')).toHaveCount(3);
  await expect(page.getByLabel('FOH · Item · riga 1')).toBeFocused();
  await page.keyboard.type('Mixing Console'); await page.keyboard.press('Tab'); await page.keyboard.type('1'); await page.keyboard.press('Tab');
  await page.keyboard.type('Yamaha DM7');
  // duplico la location FOH
  await page.locator('.sez', { has: page.getByLabel('Location name').filter({ hasText: '' }) }).first();
  await page.locator('[data-sez]').nth(1).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.sez')).toHaveCount(4);
  await expect(page.getByLabel('Location name').nth(2)).toHaveValue('FOH (copy)');
  await expect(page.getByLabel('FOH (copy) · Item · riga 1')).toHaveValue('Mixing Console');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/materiali-foglio-${info.project.name}.png`, fullPage: true });
  await salvato(page);
  await page.reload();
  await expect(page.getByLabel('FOH · Item · riga 1')).toHaveValue('Mixing Console');
  const j = righeDoc(env, 'materiali');
  expect(j.sezioni.map(s => [s.nome, s.righe.length])).toEqual([['MAIN STAGE', 6], ['FOH', 1], ['FOH (copy)', 1]]);
  // documento
  await page.getByRole('button', { name: 'Generate list' }).click();
  const doc = page.locator('article.doc');
  await expect(doc.getByRole('heading', { name: 'Material List' })).toBeVisible();
  await expect(doc.getByRole('heading', { name: 'MAIN STAGE' })).toBeVisible();
  await expect(doc.locator('table').first()).toContainText('XLR Cables');
  await expect(doc.locator('table').first().locator('tbody tr').first()).toContainText('12');
  await page.screenshot({ path: `test-results/materiali-documento-${info.project.name}.png`, fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(dl.suggestedFilename()).toBe(`Material List - Cantelmo Maria Mazzotta - ${isoDay(2)}.pdf`);
  const fs = await import('node:fs');
  fs.copyFileSync(await dl.path(), `test-results/material-list-${info.project.name}.pdf`);
  const pdf = fs.readFileSync(await dl.path()).toString('latin1');
  for (const t of ['Material List', 'MAIN STAGE', 'Microphone Stands', 'Yamaha DM7', 'FOH \\(copy\\)']) expect(pdf, t).toContain(t);
  expect(pdf).not.toContain('Unit');
  await page.getByRole('button', { name: 'Copy Text' }).click();
  await expect(page.locator('#toast')).toHaveText(/Testo copiato|Copia non riuscita/);
});

test('Material List: la libreria suggerisce materiali già usati in altri eventi e compila note; elimina location con conferma', async ({ page }) => {
  const env = await setup(page);
  const adm = tokenFor(env, ADMIN);
  const lista = apiCall(env, adm, 'eventi.list', {}).data;
  const a = apiCall(env, adm, 'produzione.assicura', { evento_id: lista.find(e => e.titolo.startsWith('Convegno')).id }).data;
  apiCall(env, adm, 'documento.salva', { produzione_id: a.id, tipo: 'materiali', versione: '0', dati: { sezioni: [{ id: 's1', nome: 'FOH', righe: [{ id: 'm1', voce: 'Mixing Console', qta: '1', unita: 'pcs', note: 'Yamaha DM7' }] }] } });
  await apriMateriali(page, env);
  await page.getByLabel('Location · Item · riga 1').click();
  await page.keyboard.type('mixi');
  await expect(page.getByRole('option', { name: /Mixing Console/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Location · Unit · riga 1')).toHaveCount(0); // la colonna Unit non esiste più
  expect(await page.getByLabel('Location · Notes · riga 1').inputValue()).toBe('Yamaha DM7');
  expect(await page.getByLabel('Location · Quantity · riga 1').inputValue()).toBe('1');
  // testo libero resta libero: non viene sostituito dal suggerimento
  await page.getByLabel('Location · Item · riga 2').click();
  await page.keyboard.type('Mixer da campo');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect(await page.getByLabel('Location · Item · riga 2').inputValue()).toBe('Mixer da campo');
  await page.getByLabel('Location name').first().fill('STAGE');
  await salvato(page);
  await page.getByRole('button', { name: /Delete location/ }).first().click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  await expect(page.locator('[data-sez]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByLabel('Location name').first()).toHaveValue('');              // resta sempre un foglio pronto
  await salvato(page);
  expect(righeDoc(env, 'materiali').sezioni).toHaveLength(0);
});

test('tablet: i fogli stanno nello schermo in verticale e in orizzontale, azioni di riga a portata di dito', async ({ page }, info) => {
  const env = await setup(page);
  await apriPlan(page, env);
  for (const [w, h] of [[820, 1180], [1180, 820]]) {
    await page.setViewportSize({ width: w, height: h });
    await noHorizontalScroll(page);
    await expect(page.getByRole('button', { name: 'Generate PdP' })).toBeVisible();
    await page.screenshot({ path: `test-results/tablet-plan-${w}-${info.project.name}.png` });
  }
  await page.getByRole('link', { name: 'Material List' }).click();
  await expect(page.getByRole('heading', { name: 'Material List' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tablet-materiali-${info.project.name}.png` });
});
