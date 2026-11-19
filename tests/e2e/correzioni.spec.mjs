/**
 * 0.13.2 · Dati del Calendar correggibili in CTRL: titolo, luogo, descrizione, date. Restano dopo la sincronizzazione,
 * se il Calendar cambia si sceglie, e il Calendar non viene mai scritto.
 */
import { test, expect } from 'playwright/test';
import { loadBackend } from '../mocks/google.mjs';

const API = 'https://api.ctrl.test/exec';
const ADMIN = 'admin@example.com';
const cspErrors = [];
test.afterEach(() => { expect(cspErrors, 'violazioni CSP').toEqual([]); cspErrors.length = 0; });
const isoDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));

async function setup(page, opzioni = {}) {
  await page.route(/script\.google(usercontent)?\.com/, (r) => r.abort());
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: opzioni.calendario || [] });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  await page.route(API, async (route) => {
    const req = JSON.parse(route.request().postData());
    const out = JSON.parse(JSON.stringify(env.ctx.handleRequest(JSON.stringify(req))));
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



const calendario = () => [{ id: 'a@google.com', title: 'Cantelmo: Salento Jaz', allDay: true, start: isoDay(3), end: isoDay(4), location: 'Cantelmo, Lecce', description: 'Referente Luca' }];

test('evento del Calendar: Modifica corregge titolo, luogo e descrizione; restano dopo la sincronizzazione e se il Calendar cambia si sceglie', async ({ page }, testInfo) => {
  const env = await setup(page, { calendario: calendario() });
  await login(page, env);
  await page.getByText('Cantelmo: Salento Jaz').first().click();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Salento Jaz' })).toBeVisible();
  await expect(page.getByText('Arriva dal Google Calendar, che CTRL legge soltanto')).toBeVisible();
  await page.getByRole('button', { name: 'Modifica' }).click();
  const dlg = page.locator('dialog[open]');
  // un evento del Calendar non ha orari né colore da cambiare qui: gli orari stanno nella giornata
  await expect(dlg.getByLabel('Ora inizio')).toHaveCount(0);
  await expect(dlg.getByLabel('Colore')).toHaveCount(0);
  await dlg.getByLabel('Titolo *').fill('Cantelmo: Salento Jazz');
  await dlg.getByLabel('Luogo').fill('Officine Cantelmo, Lecce');
  await dlg.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Salento Jazz' })).toBeVisible();
  const info = page.locator('section.card', { hasText: 'Informazioni' }).first();
  await expect(info).toContainText('Modificato da te');
  await expect(info).toContainText('Calendar: Cantelmo: Salento Jaz');
  await expect(info).toContainText('Calendar: Cantelmo, Lecce');
  // sincronizzazione con lo stesso Calendar: la correzione resta
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'sync.run', {}));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Salento Jazz' })).toBeVisible();
  // il Calendar cambia il luogo: differenza segnalata, il mio resta
  env.state.calendar.events = [{ ...calendario()[0], location: 'Teatro Paisiello, Lecce' }];
  dati(apiCall(env, t, 'sync.run', {}));
  await page.reload();
  const avviso = page.locator('.alert-lv', { hasText: 'Il Calendar è cambiato' });
  await expect(avviso).toContainText('Teatro Paisiello, Lecce');
  await expect(avviso).toContainText('Officine Cantelmo, Lecce');
  await page.screenshot({ path: `test-results/correzioni-${testInfo.project.name}.png`, fullPage: true });
  await avviso.getByRole('button', { name: 'Usa quello del Calendar' }).click();
  await expect(page.locator('.alert-lv', { hasText: 'Il Calendar è cambiato' })).toHaveCount(0);
  await expect(page.locator('section.card', { hasText: 'Informazioni' }).first().locator('a[href*="maps"]')).toHaveText('Teatro Paisiello, Lecce');
  // "Ripristina Calendar" sul titolo
  await page.getByRole('button', { name: 'Ripristina Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Cantelmo: Salento Jaz' })).toBeVisible();
  await expect(page.getByText('Modificato da te')).toHaveCount(0);
});

test('evento del Calendar: Production e Viewer non hanno Modifica; il Viewer vede solo il dato corrente', async ({ page }) => {
  const env = await setup(page, { calendario: calendario() });
  const t = tokenFor(env, ADMIN);
  const e = dati(apiCall(env, t, 'eventi.list', {}))[0];
  dati(apiCall(env, t, 'eventi.update', { id: e.id, versione: e.versione, titolo: 'Titolo corretto' }));
  const g0 = dati(apiCall(env, t, 'eventi.get', { id: e.id })).giorni[0];
  dati(apiCall(env, t, 'giorni.salva', { id: g0.id, versione: g0.versione, ora_inizio: '19:00', ora_fine: '23:00' }));
  dati(apiCall(env, t, 'utenti.save', { email: 'viewer@example.com', nome: 'Viola', ruolo: 'VIEWER' }));
  dati(apiCall(env, t, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'viewer@example.com' }));
  await login(page, env, 'viewer@example.com');
  await page.goto('/#/e/' + e.id);
  await expect(page.getByRole('heading', { name: 'Titolo corretto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifica' })).toHaveCount(0);
  // l'orario corretto nella giornata è quello che si legge nell'evento
  await expect(page.locator('dt', { hasText: 'Orario' }).locator('xpath=following-sibling::dd[1]')).toHaveText('19:00–23:00');
  await expect(page.locator('.corr')).toHaveCount(0);   // le correzioni coi valori del Calendar sono dell'Owner
  await expect(page.getByText('Salento Jaz')).toHaveCount(0);
});
