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
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  await page.route(API, async (route) => {
    const body = route.request().postData();
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
