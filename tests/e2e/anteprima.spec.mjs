/**
 * 0.12.1 · Elenco eventi: Load-in e Load-out nel riquadro, striscia di separazione tra una giornata e l'altra.
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


async function scenario(page) {
  const env = await setup(page, {});
  const t = tokenFor(env, ADMIN);
  const crea = (titolo, data, i, f, luogo) => dati(apiCall(env, t, 'eventi.create', { titolo, data, data_fine: data, ora_inizio: i, ora_fine: f, luogo }));
  const a = crea('Concerto serale', isoDay(1), '21:00', '23:30', 'Piazza Duomo');
  const b = crea('Aperitivo in giardino', isoDay(1), '18:00', '20:00', 'Villa Comunale');
  const c = crea('Festa di paese', isoDay(2), '20:00', '02:00', 'Corte Aperta');
  const d = crea('Cena aziendale', isoDay(3), '', '', 'Hotel Centrale');
  const piano = (e, giorni) => {
    const pr = dati(apiCall(env, t, 'produzione.assicura', { evento_id: e.id }));
    dati(apiCall(env, t, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '0', dati: { crew: [], giorni } }));
  };
  piano(a, [{ data: isoDay(1), righe: [{ att: 'Load-in', ora: '14:00' }, { att: 'Show Start', ora: '21:00' }, { att: 'Load-out', ora: '00:30' }] }]);
  piano(c, [{ data: isoDay(2), righe: [{ att: 'Load-in', ora: '16:30' }] }]);
  return env;
}

test('elenco: l\'orario della giornata compare una sola volta, come Load-in e Load-out, e segue le correzioni', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  const concerto = page.locator('.ev', { hasText: 'Concerto serale' });
  await expect(concerto.locator('[data-k="load-in"]')).toContainText('21:00');
  await expect(concerto.locator('[data-k="load-out"]')).toContainText('23:30');
  expect(await concerto.locator('.lo > span').evaluateAll(x => x.map(e => e.dataset.k))).toEqual(['load-in', 'load-out']);
  await expect(concerto.locator('.m')).not.toContainText(/\d\d:\d\d/);   // mai due volte
  const festa = page.locator('.ev', { hasText: 'Festa di paese' });
  await expect(festa.locator('[data-k="load-in"]')).toContainText('20:00');
  await expect(festa.locator('[data-k="load-out"]')).toContainText('02:00 +1');
  await expect(page.locator('.ev', { hasText: 'Aperitivo in giardino' }).locator('[data-k="load-in"]')).toContainText('18:00');
  await expect(page.locator('.ev', { hasText: 'Cena aziendale' }).locator('.lo')).toHaveCount(0);
  // il Production Plan non cambia l'anteprima: la dicono gli orari della giornata
  await expect(concerto).not.toContainText('14:00');
  expect(await page.locator('[role=list]').innerText()).not.toMatch(/\b(null|undefined)\b/);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
  await page.screenshot({ path: `test-results/anteprima-loadinout-${info.project.name}.png`, fullPage: true });
  // se correggo l'orario della giornata, cambia anche l'anteprima
  const t = tokenFor(env, ADMIN);
  const cena = dati(apiCall(env, t, 'eventi.list', {})).find(e => e.titolo === 'Cena aziendale');
  const g = cena.giorni[0];
  dati(apiCall(env, t, 'giorni.salva', { id: g.id, versione: g.versione, ora_inizio: '19:30', ora_fine: '23:00' }));
  await page.reload();
  await expect(page.getByRole('list')).toBeVisible();
  const cenaRiga = page.locator('.ev', { hasText: 'Cena aziendale' });
  await expect(cenaRiga.locator('[data-k="load-in"]')).toContainText('19:30');
  await expect(cenaRiga.locator('[data-k="load-out"]')).toContainText('23:00');
});

test('elenco: una striscia di giornata separa i giorni, gli eventi dello stesso giorno stanno insieme', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  const seps = page.locator('.dsep');
  await expect(seps).toHaveCount(3);
  await expect(seps.nth(0)).toHaveAttribute('data-data', isoDay(1));
  await expect(seps.nth(0)).toContainText('2 eventi');
  await expect(seps.nth(1)).toContainText('1 evento');
  // ordine nel DOM: striscia, i due eventi del primo giorno (per orario), striscia, festa, striscia, cena
  const sequenza = await page.locator('[role=list] > .dsep, [role=list] > .ev').evaluateAll(els => els.map(e => e.classList.contains('dsep') ? 'S' + e.dataset.data : (e.querySelector('.t').textContent)));
  expect(sequenza).toEqual(['S' + isoDay(1), 'Aperitivo in giardino', 'Concerto serale', 'S' + isoDay(2), 'Festa di paese', 'S' + isoDay(3), 'Cena aziendale']);
  // la striscia si vede: ha uno sfondo diverso dalla pagina e un bordo colorato sopra
  const stile = await seps.first().evaluate(el => { const c = getComputedStyle(el); return [c.backgroundColor, c.borderTopWidth, c.borderTopColor]; });
  expect(stile[1]).toBe('3px');
  expect(stile[0]).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: `test-results/anteprima-giorni-${info.project.name}.png`, fullPage: true });
});

test('elenco: la striscia di oggi è evidenziata e i passati sono attenuati', async ({ page }) => {
  const env = await setup(page, {});
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'eventi.create', { titolo: 'Evento di oggi', data: isoDay(0), data_fine: isoDay(0), ora_inizio: '23:00', ora_fine: '23:30' }));
  dati(apiCall(env, t, 'eventi.create', { titolo: 'Evento di ieri', data: isoDay(-1), data_fine: isoDay(-1), ora_inizio: '10:00', ora_fine: '11:00' }));
  await login(page, env);
  await expect(page.locator('.dsep.oggi')).toContainText('Oggi');
  await expect(page.locator('.dsep.oggi')).toHaveCount(1);
  await page.getByRole('button', { name: 'Passati' }).click();
  await expect(page.locator('.dsep.passato')).toHaveCount(1);
});
