/**
 * 0.12.0 · Staff Work Report, export Excel e popup sui nomi, nel browser vero (desktop e telefono).
 * Le date stanno nel mese corrente (giorni fissi) e il "momento" delle statistiche è fissato al 15 del mese, ore 12:00.
 */
import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBackend } from '../mocks/google.mjs';

const API = 'https://api.ctrl.test/exec';
const ADMIN = 'admin@example.com';
const cspErrors = [];
test.afterEach(() => { expect(cspErrors, 'violazioni CSP').toEqual([]); cspErrors.length = 0; });

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const MESE = OGGI.slice(0, 7);
const ANNO = OGGI.slice(0, 4);
const gg = (n) => `${MESE}-${String(n).padStart(2, '0')}`;
const MESI = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

async function setup(page, opzioni = {}) {
  await page.route(/script\.google(usercontent)?\.com/, (r) => r.abort());
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents: opzioni.calendario || [] });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  await page.route(API, async (route) => {
    const req = JSON.parse(route.request().postData());
    // il popup legge "adesso" dal server: nei test è il 15 del mese alle 12:00
    if (req.action === 'report.statistiche') req.payload = { ...req.payload, adesso: gg(15) + 'T12:00' };
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

/** Dati di prova: Marco 3 giornate (2 già svolte, 1 futura), Paola 1 futura, una giornata di evento annullato. */
async function scenario(page) {
  const cal = [{ id: 'x@g', title: 'Serata annullata', start: new Date(`${gg(25)}T17:00:00Z`).toISOString(), end: new Date(`${gg(25)}T20:00:00Z`).toISOString(), description: '' }];
  const env = await setup(page, { calendario: cal });
  const t = tokenFor(env, ADMIN);
  dati(apiCall(env, t, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION', colore: 'blu' }));
  dati(apiCall(env, t, 'utenti.save', { email: 'paola@example.com', nome: 'Paola Neri De Santis', ruolo: 'PRODUCTION', colore: 'rosa' }));
  dati(apiCall(env, t, 'utenti.save', { email: 'vito@example.com', nome: 'Vito Bruni', ruolo: 'VIEWER', colore: 'verde' }));
  const crea = (titolo, data, i, f, luogo) => dati(apiCall(env, t, 'eventi.create', { titolo, data, data_fine: data, ora_inizio: i, ora_fine: f, luogo }));
  const e1 = crea('Concerto al Castello', gg(10), '10:00', '14:00', 'Castello Carlo V, Lecce');
  const e2 = crea('Notte in piazza', gg(12), '22:00', '02:00', 'Piazza Sant\'Oronzo');
  const e3 = crea('Sagra del vino', gg(20), '18:00', '23:00', 'Corte Aperta');
  const e4 = crea('Befana in piazza', `${Number(ANNO) + 1}-01-06`, '10:00', '12:00', 'Piazza Mazzini');
  const add = (e, email) => dati(apiCall(env, t, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email }));
  add(e1, 'marco@example.com'); add(e2, 'marco@example.com'); add(e3, 'marco@example.com'); add(e3, 'paola@example.com'); add(e4, 'paola@example.com');
  const ann = dati(apiCall(env, t, 'eventi.list', {})).find(e => e.titolo === 'Serata annullata');
  add(ann, 'marco@example.com');
  env.state.calendar.events = [];
  dati(apiCall(env, t, 'sync.run', {}));
  return env;
}

/** Riga della lista: gli eventi di prova possono essere già passati, quindi si prova anche "Passati". */
async function rigaLista(page, titolo) {
  const riga = page.locator('.ev', { hasText: titolo }).first();
  await page.waitForTimeout(300);
  if (!(await riga.count())) await page.getByRole('button', { name: 'Passati' }).click();
  await expect(riga).toBeVisible();
  return riga;
}

async function nessunoScrollOrizzontale(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
}

test('report: tabella, filtri, storico per tecnico, eventi annullati segnalati e fuori dai totali', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  await page.goto('/#/report');
  await expect(page.getByRole('heading', { name: 'Staff Work Report' })).toBeVisible();
  const mobile = info.project.name === 'mobile';
  if (!mobile) for (const c of ['Data', 'Giorno', 'Tecnico', 'Evento', 'Location', 'Inizio', 'Fine', 'Durata', 'Nota']) await expect(page.getByRole('columnheader', { name: c })).toBeVisible();
  // mese corrente: 5 righe (4 di Marco incluso l'annullato, 1 di Paola)
  const righe = page.locator('table.rp tbody tr');
  await expect(righe).toHaveCount(5);
  await expect(page.locator('[data-k="giornate"]')).toHaveText('4');                // 3 di Marco + 1 di Paola, l'annullata no
  await expect(page.locator('[data-k="ore"]')).toHaveText('18 h');   // 4 + 4 + 5 + 5
  const notte = righe.filter({ hasText: 'Notte in piazza' });
  await expect(notte).toContainText('22:00');
  await expect(notte).toContainText('02:00');
  await expect(notte).toContainText('+1 giorno');
  await expect(notte).toContainText('4 h');
  const ann = righe.filter({ hasText: 'Serata annullata' });
  await expect(ann).toHaveClass(/annullato/);
  await expect(ann.getByText('Annullato', { exact: true })).toBeVisible();
  await expect(page.getByText('1 giornata di evento annullato esclusa dai totali.')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/\b(null|undefined)\b/);
  await nessunoScrollOrizzontale(page);
  await page.screenshot({ path: `test-results/report-${info.project.name}.png`, fullPage: true });

  // nascondi annullati
  await page.getByLabel('Mostra eventi annullati').uncheck();
  await expect(righe).toHaveCount(4);
  await page.getByLabel('Mostra eventi annullati').check();
  await expect(righe).toHaveCount(5);

  // storico di un tecnico: dal riepilogo
  await page.locator('.rp-tec[data-email="paola@example.com"]').click();
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('Paola Neri De Santis');
  await expect(page.locator('[data-k="giornate"]')).toHaveText('1');
  await page.screenshot({ path: `test-results/report-tecnico-${info.project.name}.png`, fullPage: true });
  await page.locator('.rp-tec[data-email="paola@example.com"]').click();
  await expect(righe).toHaveCount(5);

  // filtri: tecnico, evento, intervallo di date, mese e anno
  await page.getByLabel('Tecnico', { exact: true }).selectOption('marco@example.com');
  await expect(righe).toHaveCount(4);
  await page.getByLabel('Evento', { exact: true }).selectOption({ label: 'Sagra del vino' });
  await expect(righe).toHaveCount(1);
  await page.getByLabel('Evento', { exact: true }).selectOption('');
  await page.getByLabel('Tecnico', { exact: true }).selectOption('');
  await page.getByLabel('Dal', { exact: true }).fill(gg(11));
  await page.getByLabel('Al', { exact: true }).fill(gg(19));
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('Notte in piazza');
  await page.getByRole('button', { name: 'Mese corrente' }).click();
  await expect(righe).toHaveCount(5);
  await page.getByLabel('Mese', { exact: true }).selectOption('');
  await expect(righe).toHaveCount(5);
  await page.getByLabel('Anno', { exact: true }).selectOption(String(Number(ANNO) + 1));
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('Befana in piazza');
  await page.getByLabel('Anno', { exact: true }).selectOption(ANNO);
  await expect(righe).toHaveCount(5);
  await page.getByLabel('Mese', { exact: true }).selectOption(MESE.slice(5) === '01' ? '02' : '01');
  await expect(page.getByText('Nessuna giornata')).toBeVisible();
  await page.getByRole('button', { name: 'Mese corrente' }).click();
  await expect(righe).toHaveCount(5);
  if (mobile) {
    const w = await righe.first().locator('td').first().evaluate(el => getComputedStyle(el).display);
    expect(w).toBe('grid');
    for (const b of await page.locator('button.link, .rp-tec, .btn').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
  }
});

test('esporta report mensile: file .xlsx vero con i tre fogli, formule e nome corretto', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  await page.goto('/#/report');
  await expect(page.locator('table.rp tbody tr')).toHaveCount(5);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Esporta report mensile (.xlsx)' }).click()]);
  const atteso = `STAFF_WORK_REPORT_${MESI[Number(MESE.slice(5)) - 1]}_${ANNO}.xlsx`;
  expect(dl.suggestedFilename()).toBe(atteso);
  const dir = mkdtempSync(join(tmpdir(), 'ctrl-xlsx-'));
  const file = join(dir, atteso);
  await dl.saveAs(file);
  writeFileSync(join(dir, 'check.py'), `
import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
assert wb.sheetnames == ['WORK LOG', 'TECHNICIAN SUMMARY', 'EVENT SUMMARY'], wb.sheetnames
ws = wb['WORK LOG']
head = [c.value for c in ws[1]]
assert head == ['Date','Day','First Name','Last Name','Event','Location','Start','End','Total Hours','Notes','Event ID'], head
assert ws.max_row == 5, ws.max_row            # intestazione + 4 giornate (l'annullata non c'è)
assert ws.freeze_panes == 'A2' and ws.auto_filter.ref.startswith('A1:')
assert str(ws['I2'].value).startswith('=IF(')
ev = [ws.cell(r,5).value for r in range(2, ws.max_row+1)]
assert 'Serata annullata' not in ev, ev
assert 'Notte in piazza' in ev
paola = [r for r in range(2, ws.max_row+1) if ws.cell(r,3).value == 'Paola']
assert paola and ws.cell(paola[0],4).value == 'Neri De Santis'
print('OK')
`);
  const out = execFileSync('python3', ['-I', join(dir, 'check.py'), file], { encoding: 'utf8' });
  expect(out.trim()).toBe('OK');
  // il file è un vero .xlsx (zip): firma PK
  const firma = execFileSync('head', ['-c', '2', file]).toString();
  expect(firma).toBe('PK');
  void info;
});

test('popup sul nome: numeri del mese corrente (hover su desktop, tocco su telefono), solo Owner', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  const mobile = info.project.name === 'mobile';
  await (await rigaLista(page, 'Concerto al Castello')).click();
  await expect(page.getByRole('heading', { name: 'Concerto al Castello', level: 1 })).toBeVisible();
  // bug trovato guardando la schermata: un elemento assente nella riga del turno scriveva "null" nella pagina
  expect(await page.locator('.pane-detail').innerText()).not.toMatch(/\b(null|undefined)\b/);
  expect(await page.locator('.g-staff .riga').first().innerText()).not.toMatch(/null|undefined/);
  const nome = page.locator('.pane-detail .nm.has-stat', { hasText: 'Marco' }).first();
  await expect(nome).toBeVisible();
  if (mobile) await nome.tap(); else await nome.hover();
  const pop = page.locator('.stat-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('MARCO SERRA');
  await expect(pop).toContainText('Mese corrente');
  // al 15 del mese 12:00: svolte 10 (4 h) e 12 (4 h) · future 20 · l'annullata non conta
  await expect(pop.locator('[data-k="lavorate"]')).toHaveText('2');
  await expect(pop.locator('[data-k="future"]')).toHaveText('1');
  await expect(pop.locator('[data-k="ore"]')).toHaveText('8 h');
  await expect(pop).not.toContainText('Eventi');
  if (mobile) {
    const b = await pop.boundingBox();
    expect(b.y + b.height).toBeGreaterThan(await page.evaluate(() => window.innerHeight) - 2);   // si apre dal basso
    expect(page.url()).toContain('#/e/');                                                       // il tocco non ha aperto altro
  }
  await page.screenshot({ path: `test-results/popup-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  // Escape e tocco fuori chiudono; un secondo tocco/hover lo riapre
  if (mobile) { await nome.tap(); await expect(pop).toBeVisible(); await page.mouse.click(5, 5); await expect(pop).toHaveCount(0); }
});

test('popup: dal clic col mouse sulla riga dell\'elenco si apre ancora l\'evento, il tocco no', async ({ page }, info) => {
  const env = await scenario(page);
  await login(page, env);
  const riga = await rigaLista(page, 'Sagra del vino');
  const nome = riga.locator('.nm.has-stat', { hasText: 'Paola' });
  await expect(nome).toBeVisible();
  if (info.project.name === 'mobile') {
    await nome.tap();
    await expect(page.locator('.stat-pop')).toBeVisible();
    await expect(page.locator('.stat-pop [data-k="future"]')).toHaveText('1');
    await expect(page).not.toHaveURL(/#\/e\//);
  } else {
    await nome.hover();
    await expect(page.locator('.stat-pop')).toBeVisible();
    await expect(page.locator('.stat-pop [data-k="lavorate"]')).toHaveText('0');
    await nome.click();
    await expect(page).toHaveURL(/#\/e\//);
  }
});

test('solo Owner: Production e Viewer non vedono il report, né il popup, né possono aprirlo', async ({ page }) => {
  const env = await scenario(page);
  const prod = tokenFor(env, 'marco@example.com');
  expect(apiCall(env, prod, 'report.righe', {}).error.code).toBe('FORBIDDEN');
  expect(apiCall(env, prod, 'report.statistiche', {}).error.code).toBe('FORBIDDEN');
  await login(page, env, 'marco@example.com');
  await expect(page.locator('a[href="#/report"]')).toHaveCount(0);
  await expect(page.locator('.nm.has-stat')).toHaveCount(0);
  await page.goto('/#/report');
  await expect(page.getByRole('heading', { name: 'Staff Work Report' })).toHaveCount(0);
  await expect(page.getByRole('list')).toBeVisible();      // rimandato all'elenco eventi
  // il Viewer non ha nemmeno l'accesso
  const vito = tokenFor(env, 'vito@example.com');
  expect(apiCall(env, vito, 'report.righe', {}).error.code).toBe('FORBIDDEN');
});
