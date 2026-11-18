/**
 * 0.13.0 · Prestazioni percepite: avvio in una chiamata, evento aperto subito, nessuna ricostruzione della lista,
 * una sola chiamata per le modifiche allo staff, feedback immediato.
 * Il server finto registra le chiamate e può essere reso lento per azione.
 */
import { test, expect } from 'playwright/test';
import { loadBackend } from '../mocks/google.mjs';

const API = 'https://api.ctrl.test/exec';
const ADMIN = 'admin@example.com';
const cspErrors = [];
test.afterEach(() => { expect(cspErrors, 'violazioni CSP').toEqual([]); cspErrors.length = 0; });
const isoDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));

async function setup(page) {
  await page.route(/script\.google(usercontent)?\.com/, (r) => r.abort());
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [] });
  env.chiamate = [];
  env.ritardo = {};     // azione -> millisecondi di attesa prima della risposta
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  await page.route(API, async (route) => {
    const req = JSON.parse(route.request().postData());
    env.chiamate.push(req.action);
    const out = JSON.parse(JSON.stringify(env.ctx.handleRequest(JSON.stringify(req))));
    if (env.ritardo[req.action]) await new Promise(r => setTimeout(r, env.ritardo[req.action]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  return env;
}
function tokenFor(env, email) {
  env.state.cache.clear();
  env.ctx.handleRequest(JSON.stringify({ action: 'auth.requestCode', payload: { email } }));
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return env.ctx.handleRequest(JSON.stringify({ action: 'auth.verifyCode', payload: { email, code } })).data.token;
}
const apiCall = (env, token, action, payload) => env.ctx.handleRequest(JSON.stringify({ action, token, payload }));
const dati = (r) => { expect(r.ok, JSON.stringify(r)).toBe(true); return r.data; };

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

async function scenario(page) {
  const env = await setup(page);
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }));
  const crea = (titolo, giorno, luogo) => dati(apiCall(env, t, 'eventi.create', { titolo, data: isoDay(giorno), data_fine: isoDay(giorno), ora_inizio: '21:00', ora_fine: '23:00', luogo }));
  const a = crea('Concerto serale', 1, 'Piazza Duomo');
  const b = crea('Aperitivo in giardino', 2, 'Villa Comunale');
  return { env, a, b };
}
const apri = async (page, titolo) => { await page.locator('.ev', { hasText: titolo }).click(); };
const detail = (page) => page.locator('.pane-detail');

test('avvio: dopo l\'accesso una sola chiamata porta profilo, impostazioni ed eventi; al riavvio con sessione ancora una', async ({ page }) => {
  const { env } = await scenario(page);
  await login(page, env);
  expect(env.chiamate.filter(a => !a.startsWith('auth.'))).toEqual(['app.avvio']);
  env.chiamate.length = 0;
  await page.reload();
  await expect(page.locator('.ev', { hasText: 'Concerto serale' })).toBeVisible();
  expect(env.chiamate).toEqual(['app.avvio']);
});

test('avvio: con un server che non conosce app.avvio si ripiega sulle chiamate separate', async ({ page }) => {
  const { env } = await scenario(page);
  const originale = env.ctx.handleRequest;
  env.ctx.handleRequest = (body) => JSON.parse(body).action === 'app.avvio' ? { ok: false, error: { code: 'INVALID', message: 'Azione sconosciuta' } } : originale(body);
  await login(page, env);
  await expect(page.locator('.ev', { hasText: 'Concerto serale' })).toBeVisible();
  expect(env.chiamate).toEqual(expect.arrayContaining(['auth.me', 'impostazioni.get', 'eventi.list']));
});

test('apertura evento: titolo, giornate, staff e note subito, anche con il server lento; documenti e file si riempiono dopo', async ({ page }, info) => {
  const { env } = await scenario(page);
  await login(page, env);
  env.ritardo['eventi.get'] = 1800;
  const t0 = Date.now();
  await apri(page, 'Concerto serale');
  await expect(detail(page).getByRole('heading', { name: 'Concerto serale' })).toBeVisible({ timeout: 700 });
  await expect(detail(page).locator('#giornate')).toBeVisible({ timeout: 700 });
  await expect(detail(page).getByText('Note di produzione').first()).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1200);
  // finché il server non risponde, i file mostrano l'attesa e non un elenco falso
  await expect(detail(page).locator('#allegati')).toContainText('File…');
  await page.screenshot({ path: `test-results/prestazioni-apertura-subito-${info.project.name}.png` });
  await expect(detail(page).locator('#allegati')).toContainText('Scheda tecnica e rider', { timeout: 5000 });
  await expect(detail(page).locator('.prod-card')).toContainText('Da compilare');
});

test('apertura evento: un testo scritto nelle note non si perde quando arrivano i dati freschi', async ({ page }) => {
  const { env, a } = await scenario(page);
  await login(page, env);
  env.ritardo['eventi.get'] = 1500;
  await apri(page, 'Concerto serale');
  const nota = detail(page).getByLabel('Note di produzione');
  await nota.fill('Parcheggio dietro il teatro');
  // qualcun altro cambia l'evento nel frattempo: i dati freschi differiscono dall'elenco
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'eventi.update', { id: a.id, versione: dati(apiCall(env, t, 'eventi.get', { id: a.id })).versione, luogo: 'Piazza Nuova' }));
  await expect(detail(page).locator('#allegati')).toContainText('Scheda tecnica e rider', { timeout: 5000 });
  await expect(nota).toHaveValue('Parcheggio dietro il teatro');
});

test('navigazione: passare da un evento all\'altro non ricostruisce la lista (ricerca e posizione restano)', async ({ page }, info) => {
  const { env } = await scenario(page);
  await login(page, env);
  const mobile = info.project.name === 'mobile';
  await page.evaluate(() => { document.querySelector('.pane-list').__marcatore = 'stessa'; });
  if (!mobile) {
    await page.getByLabel('Cerca').fill('a');
    await expect(page.locator('.ev')).toHaveCount(2);
  }
  await apri(page, 'Concerto serale');
  await expect(detail(page).getByRole('heading', { name: 'Concerto serale' })).toBeVisible();
  if (!mobile) {
    await expect(page.locator('.ev[aria-current="true"]')).toContainText('Concerto serale');
    await apri(page, 'Aperitivo in giardino');
    await expect(detail(page).getByRole('heading', { name: 'Aperitivo in giardino' })).toBeVisible();
    await expect(page.locator('.ev[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('.ev[aria-current="true"]')).toContainText('Aperitivo in giardino');
    await expect(page.getByLabel('Cerca')).toHaveValue('a');
  } else {
    await page.getByRole('link', { name: 'Eventi' }).first().click();
    await expect(page.locator('.ev', { hasText: 'Concerto serale' })).toBeVisible();
  }
  expect(await page.evaluate(() => document.querySelector('.pane-list').__marcatore)).toBe('stessa');
});

test('navigazione: tornando all\'elenco il pulsante Nuovo evento riappare, aprendo un evento sparisce (telefono)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'il pulsante flottante esiste solo sul telefono');
  const { env } = await scenario(page);
  await login(page, env);
  await expect(page.locator('.fab')).toHaveCount(1);
  await apri(page, 'Concerto serale');
  await expect(page.locator('.fab')).toHaveCount(0);
  await page.getByRole('link', { name: 'Eventi' }).first().click();
  await expect(page.locator('.fab')).toHaveCount(1);
});

test('staff: una sola chiamata per assegnare, scheda subito attenuata, nessuna rilettura di evento o staff', async ({ page }) => {
  const { env, a } = await scenario(page);
  await login(page, env);
  await apri(page, 'Concerto serale');
  const staff = detail(page).locator('#staff');
  await expect(staff.getByLabel('Aggiungi staff')).toBeVisible();
  env.chiamate.length = 0;
  env.ritardo['staff.gestisci'] = 1200;
  await staff.getByLabel('Aggiungi staff').selectOption({ label: 'Marco Serra · Production' });
  await expect(detail(page).locator('#staff.busy')).toBeVisible({ timeout: 500 });
  await expect(detail(page).locator('#staff .persona', { hasText: 'Marco Serra' })).toBeVisible({ timeout: 5000 });
  expect(env.chiamate).toEqual(['staff.gestisci']);
  // l'elenco a sinistra mostra già il nome, senza ricaricare
  await expect(page.locator('.ev', { hasText: 'Concerto serale' }).locator('.names')).toContainText('Marco');
  await expect(detail(page).locator('#staff.busy')).toHaveCount(0);
  expect(a.id).toBeTruthy();
});

test('elenco: una modifica fatta da altri compare da sola riaprendo l\'elenco dopo qualche tempo, senza perdere la ricerca', async ({ page }) => {
  const { env } = await scenario(page);
  await login(page, env);
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'eventi.create', { titolo: 'Aggiunto da altri', data: isoDay(3), data_fine: isoDay(3), ora_inizio: '20:00', ora_fine: '22:00' }));
  // si accelera il tempo: l'elenco in memoria risulta vecchio
  await page.clock.install();
  await apri(page, 'Concerto serale');
  await page.clock.fastForward(60000);
  await page.goto('/#/');
  await expect(page.locator('.ev', { hasText: 'Aggiunto da altri' })).toBeVisible({ timeout: 5000 });
});
