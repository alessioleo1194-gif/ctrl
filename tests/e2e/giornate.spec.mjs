/**
 * Giornate, orari modificabili e controllo disponibilità dello staff, nel browser vero (desktop e telefono).
 */
import { test, expect } from 'playwright/test';
import { loadBackend } from '../mocks/google.mjs';

const API = 'https://api.ctrl.test/exec';
const ADMIN = 'admin@example.com';
const cspErrors = [];
test.afterEach(() => { expect(cspErrors, 'violazioni CSP').toEqual([]); cspErrors.length = 0; });

const isoDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + offset * 86400000));
function romeIso(day, hhmm) {
  for (const off of ['+01:00', '+02:00']) {
    const d = new Date(`${day}T${hhmm}:00${off}`);
    if (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) === hhmm) return d.toISOString();
  }
}
const orario = (id, title, giorno, da, a, extra = {}) => ({ id, title, start: romeIso(isoDay(giorno), da), end: romeIso(isoDay(giorno), a), description: '', ...extra });

async function setup(page, calendarEvents) {
  await page.route(/script\.google(usercontent)?\.com/, (r) => r.abort());
  const env = loadBackend({ adminEmail: ADMIN, calendarEvents });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text()); });
  env.ctx.setupProduzione();
  await page.addInitScript((url) => { window.__CTRL_API__ = url; }, API);
  await page.route(API, async (route) => {
    const out = JSON.parse(JSON.stringify(env.ctx.handleRequest(route.request().postData())));
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

async function apri(page, titolo) {
  await page.locator('.ev', { hasText: titolo }).first().click();
  await expect(page.getByRole('heading', { name: titolo, level: 1 })).toBeVisible();
}

async function nessunoScrollOrizzontale(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
}

/** Su telefono i bersagli da toccare devono essere alti almeno 44 px. */
async function tocchiGrandi(page, locator, info) {
  if (info.project.name !== 'mobile') return;
  for (const b of await locator.all()) {
    const box = await b.boundingBox();
    expect(box.height, await b.textContent()).toBeGreaterThanOrEqual(43.5);
  }
}

test('giornata: orario corretto a mano, resta dopo la sincronizzazione e segnala la differenza col Calendar', async ({ page }, info) => {
  const cal = [orario('a@g', 'Concerto in piazza', 3, '21:00', '23:00', { location: 'Piazza Duomo, Lecce' })];
  const env = await setup(page, cal);
  await login(page, env);
  await apri(page, 'Concerto in piazza');
  const giorno = page.locator('.giorno');
  await expect(giorno).toHaveCount(1);
  await expect(giorno.getByText('Dal Calendar')).toBeVisible();
  await expect(giorno.locator('input[aria-label^="Inizio"]')).toHaveValue('21:00');

  // l'Owner scrive 2330 e 0030 (dopo la mezzanotte): il campo normalizza, compare "+1 giorno"
  await giorno.locator('input[aria-label^="Inizio"]').fill('2030');
  await giorno.locator('input[aria-label^="Fine"]').fill('0030');
  await giorno.locator('input[aria-label^="Fine"]').blur();
  await expect(giorno.locator('input[aria-label^="Fine"]')).toHaveValue('00:30');
  await expect(giorno.getByText('+1 giorno')).toBeVisible();
  await expect(giorno.getByText('Modifiche non salvate')).toBeVisible();
  await nessunoScrollOrizzontale(page);
  await tocchiGrandi(page, giorno.locator('button'), info);
  await giorno.getByRole('button', { name: 'Salva giornata' }).click();
  await expect(giorno.getByText('Modificato da te')).toBeVisible();
  await expect(giorno.getByText('Calendar: 21:00–23:00')).toBeVisible();
  await expect(giorno.getByRole('button', { name: 'Ripristina Calendar' })).toBeVisible();
  await page.screenshot({ path: `test-results/giornata-modificata-${info.project.name}.png`, fullPage: true });

  // il Calendar cambia e CTRL si sincronizza: l'orario scritto a mano NON viene toccato, compare la differenza
  env.state.calendar.events = [orario('a@g', 'Concerto in piazza', 3, '22:00', '23:30', { location: 'Piazza Duomo, Lecce' })];
  dati(apiCall(env, tokenFor(env, ADMIN), 'sync.run', {}));
  await page.reload();
  const g2 = page.locator('.giorno');
  await expect(g2.getByText('Il Calendar è cambiato.')).toBeVisible();
  await expect(g2.locator('input[aria-label^="Inizio"]')).toHaveValue('20:30');
  await page.screenshot({ path: `test-results/giornata-differenza-${info.project.name}.png`, fullPage: true });
  await tocchiGrandi(page, g2.locator('.alert-lv button'), info);
  await g2.getByRole('button', { name: 'Tieni la mia' }).click();
  await expect(g2.getByText('Il Calendar è cambiato.')).toHaveCount(0);
  await expect(g2.locator('input[aria-label^="Inizio"]')).toHaveValue('20:30');

  // di nuovo cambiato: "Usa quello del Calendar" riporta l'orario del Calendar
  env.state.calendar.events = [orario('a@g', 'Concerto in piazza', 3, '22:30', '23:45', { location: 'Piazza Duomo, Lecce' })];
  dati(apiCall(env, tokenFor(env, ADMIN), 'sync.run', {}));
  await page.reload();
  await page.locator('.giorno').getByRole('button', { name: 'Usa quello del Calendar' }).click();
  await expect(page.locator('.giorno').getByText('Dal Calendar')).toBeVisible();
  await expect(page.locator('.giorno input[aria-label^="Inizio"]')).toHaveValue('22:30');
});

test('giornate: evento su tre giorni, una sezione per giornata, aggiunta e rimozione', async ({ page }, info) => {
  const cal = [{ id: 'f@g', title: 'Festival del mare', allDay: true, start: isoDay(6), end: isoDay(9), description: '' }];
  const env = await setup(page, cal);
  await login(page, env);
  await expect(page.locator('.ev')).toHaveCount(3);
  await expect(page.locator('.ev').nth(0)).toContainText('Giorno 1 di 3');
  await expect(page.locator('.ev').nth(2)).toContainText('Giorno 3 di 3');
  await apri(page, 'Festival del mare');
  await expect(page.locator('.giorno')).toHaveCount(3);
  await expect(page.locator('.giorno').nth(1)).toContainText('Giorno 2 di 3');
  await nessunoScrollOrizzontale(page);
  await page.locator('.giorno').nth(1).getByRole('textbox', { name: 'Nota della giornata' }).fill('Soundcheck alle 16');
  await page.locator('.giorno input[aria-label^="Inizio"]').nth(1).fill('1600');
  await page.locator('.giorno').nth(1).getByRole('button', { name: 'Salva giornata' }).click();
  await expect(page.locator('.giorno').nth(1).getByText('Modifiche non salvate')).toHaveCount(0);
  await expect(page.locator('.giorno').nth(1).getByRole('textbox', { name: 'Nota della giornata' })).toHaveValue('Soundcheck alle 16');
  await expect(page.locator('.giorno input[aria-label^="Inizio"]').nth(1)).toHaveValue('16:00');

  // aggiunge il montaggio il giorno prima
  await page.getByRole('button', { name: 'Aggiungi giornata' }).click();
  await page.getByLabel('Data della nuova giornata').fill(isoDay(5));
  await page.getByRole('textbox', { name: 'Inizio', exact: true }).fill('1400');
  await page.getByRole('textbox', { name: 'Fine', exact: true }).fill('1900');
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.locator('.giorno')).toHaveCount(4);
  await expect(page.locator('.giorno').first()).toContainText('Aggiunta a mano');
  await expect(page.locator('.giorno').first()).toContainText('Giorno 1 di 4');
  await page.screenshot({ path: `test-results/giornate-tre-${info.project.name}.png`, fullPage: true });

  // toglie una giornata: serve un secondo tocco di conferma
  await tocchiGrandi(page, page.locator('.giorno').first().locator('button'), info);
  const rim = page.locator('.giorno').first().getByRole('button', { name: 'Rimuovi giornata' });
  await rim.click();
  await page.locator('.giorno').first().getByRole('button', { name: 'Conferma rimozione' }).click();
  await expect(page.locator('.giorno')).toHaveCount(3);
});

test('staff: avviso di sovrapposizione, "assegna comunque" e solo i giorni liberi', async ({ page }, info) => {
  const cal = [
    { id: 'c@g', title: 'Concerto sul porto', start: romeIso(isoDay(7), '20:00'), end: romeIso(isoDay(7), '23:00'), description: '' },
    { id: 'f@g', title: 'Festival delle luci', allDay: true, start: isoDay(6), end: isoDay(9), description: '' },
    { id: 'p@g', title: 'Cena di gala', start: romeIso(isoDay(6), '19:00'), end: romeIso(isoDay(6), '22:00'), description: '' }
  ];
  const env = await setup(page, cal);
  const adm = tokenFor(env, ADMIN);
  dati(apiCall(env, adm, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION', colore: 'blu' }));
  const eventi = dati(apiCall(env, adm, 'eventi.list', {}));
  const idDi = (t) => eventi.find(e => e.titolo.startsWith(t)).id;
  // Marco è già al concerto (giornata 2 del festival) e alla cena (giornata 1)
  dati(apiCall(env, adm, 'staff.gestisci', { evento_id: idDi('Concerto'), azione: 'aggiungi', email: 'marco@example.com' }));
  dati(apiCall(env, adm, 'staff.gestisci', { evento_id: idDi('Cena'), azione: 'aggiungi', email: 'marco@example.com' }));
  // il festival ha orari definiti: 10–18 il primo giorno, 19:00–23:30 il secondo, 10–18 il terzo
  const fest = dati(apiCall(env, adm, 'eventi.get', { id: idDi('Festival') }));
  const orariFest = [['10:00', '18:00'], ['19:00', '23:30'], ['10:00', '18:00']];
  fest.giorni.forEach((g, i) => dati(apiCall(env, adm, 'giorni.salva', { id: g.id, versione: g.versione, ora_inizio: orariFest[i][0], ora_fine: orariFest[i][1] })));
  // la cena (19–22 del primo giorno) non si sovrappone al festival del primo giorno (10–18)

  await login(page, env);
  await apri(page, 'Festival delle luci');
  await page.getByLabel('Aggiungi staff').selectOption({ label: 'Marco Serra · Production · sovrapposizione' });
  const pannello = page.locator('.assegna');
  await expect(pannello).toBeVisible();
  await expect(pannello.locator('.as-g')).toHaveCount(3);
  await expect(pannello.locator('.as-g').nth(1).locator('.lv.lv-rosso')).toHaveText('Sovrapposizione');
  await expect(pannello.locator('.as-g').nth(1)).toContainText('Concerto sul porto');
  await expect(pannello.locator('.as-g').nth(0).locator('.lv.lv-azzurro')).toBeVisible();   // stesso giorno della cena, orari che non si toccano
  await expect(pannello.locator('.as-g').nth(2).locator('.lv.lv-verde')).toBeVisible();
  await expect(pannello.getByRole('button', { name: 'Assegna comunque' })).toBeVisible();
  await expect(pannello.getByRole('button', { name: 'Assegna solo i giorni liberi' })).toBeVisible();
  await nessunoScrollOrizzontale(page);
  await page.screenshot({ path: `test-results/staff-conflitto-${info.project.name}.png`, fullPage: true });
  await tocchiGrandi(page, pannello.locator('button'), info);

  // la scelta delle giornate ricalcola l'avviso: tolta la seconda, non c'è più il rosso
  await pannello.locator('.as-g').nth(1).locator('input').uncheck();
  await expect(pannello.getByRole('button', { name: 'Assegna comunque' })).toHaveCount(0);
  await expect(pannello.getByRole('button', { name: 'Assegna', exact: true })).toBeVisible();
  await pannello.locator('.as-g').nth(1).locator('input').check();
  await expect(pannello.getByRole('button', { name: 'Assegna comunque' })).toBeVisible();

  // solo i giorni liberi (il primo ha lo stesso giorno ma orari compatibili: libero)
  await pannello.getByRole('button', { name: 'Assegna solo i giorni liberi' }).click();
  await expect(page.locator('.staff-pers')).toContainText('Lavora: 2 di 3 giornate');
  await expect(page.locator('.giorno').nth(1).getByText('Nessuno assegnato a questa giornata.')).toBeVisible();
  await expect(page.locator('.giorno').nth(0).locator('.riga')).toContainText('Marco');
  await expect(page.locator('.giorno').nth(0).locator('.riga .lv.lv-azzurro')).toBeVisible();
  await expect(page.locator('.giorno .lv.lv-rosso')).toHaveCount(0);

  // "assegna comunque": Marco entra anche nella giornata in conflitto, il rosso compare in giornata, in staff e in lista
  await page.locator('.staff-pers').getByRole('button', { name: 'Modifica giornate' }).click();
  await expect(page.locator('.assegna .as-g').nth(1).locator('.lv.lv-rosso')).toBeVisible();
  await page.locator('.assegna .as-g').nth(1).locator('input').check();
  await page.locator('.assegna').getByRole('button', { name: 'Salva giornate' }).click();
  await expect(page.locator('.giorno').nth(1).locator('.riga .lv.lv-rosso')).toHaveText('Sovrapposizione');
  await expect(page.locator('.giorno').nth(1).locator('.riga')).toContainText('Concerto sul porto');
  await expect(page.locator('.giorno').nth(1).locator('.gh .lv.lv-rosso')).toBeVisible();
  await page.screenshot({ path: `test-results/staff-assegnato-comunque-${info.project.name}.png`, fullPage: true });

  // elenco eventi: la riga della giornata in conflitto è segnalata
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('.ev', { hasText: 'Festival delle luci' }).filter({ hasText: 'Giorno 2 di 3' }).locator('.lv.lv-rosso')).toBeVisible();
  await expect(page.locator('.ev', { hasText: 'Festival delle luci' }).filter({ hasText: 'Giorno 3 di 3' }).locator('.lv.lv-rosso')).toHaveCount(0);
  await nessunoScrollOrizzontale(page);
  await page.screenshot({ path: `test-results/lista-giornate-${info.project.name}.png`, fullPage: true });
});

test('turno di una persona: orario proprio diverso dalla giornata, e il conflitto sparisce', async ({ page }, info) => {
  const cal = [orario('a@g', 'Primo set', 3, '18:00', '22:00'), orario('b@g', 'Secondo set', 3, '21:00', '23:00')];
  const env = await setup(page, cal);
  const adm = tokenFor(env, ADMIN);
  dati(apiCall(env, adm, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION', colore: 'blu' }));
  const ev = (t) => dati(apiCall(env, adm, 'eventi.list', {})).find(e => e.titolo.startsWith(t));
  dati(apiCall(env, adm, 'staff.gestisci', { evento_id: ev('Primo').id, azione: 'aggiungi', email: 'marco@example.com' }));
  dati(apiCall(env, adm, 'staff.gestisci', { evento_id: ev('Secondo').id, azione: 'aggiungi', email: 'marco@example.com' }));
  await login(page, env);
  await apri(page, 'Primo set');
  const riga = page.locator('.giorno .riga');
  await expect(riga.locator('.lv.lv-rosso')).toBeVisible();
  await riga.getByRole('button', { name: /Orario di Marco/ }).click();
  await riga.getByLabel('Fine turno').fill('2100');
  await riga.getByLabel('Nota del turno').fill('Solo montaggio');
  await tocchiGrandi(page, riga.locator('button'), info);
  await nessunoScrollOrizzontale(page);
  await riga.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.locator('.giorno .riga .lv.lv-rosso')).toHaveCount(0);       // 18:00–21:00 e 21:00–23:00 si toccano soltanto
  await expect(page.locator('.giorno .riga')).toContainText('Solo montaggio');
  await expect(page.locator('.giorno .riga .t.proprio')).toHaveText('18:00–21:00');
  await expect(page.locator('.giorno .riga .lv.lv-azzurro')).toBeVisible();
});

test('chi non è Owner non vede orari dei turni né conflitti', async ({ page }) => {
  const cal = [orario('a@g', 'Primo set', 3, '18:00', '22:00'), orario('b@g', 'Secondo set', 3, '21:00', '23:00')];
  const env = await setup(page, cal);
  const adm = tokenFor(env, ADMIN);
  dati(apiCall(env, adm, 'utenti.save', { email: 'paola@example.com', nome: 'Paola Neri', ruolo: 'PRODUCTION', colore: 'viola' }));
  dati(apiCall(env, adm, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION', colore: 'blu' }));
  const ev = (t) => dati(apiCall(env, adm, 'eventi.list', {})).find(e => e.titolo.startsWith(t));
  for (const t of ['Primo', 'Secondo']) dati(apiCall(env, adm, 'staff.gestisci', { evento_id: ev(t).id, azione: 'aggiungi', email: 'marco@example.com' }));
  dati(apiCall(env, adm, 'staff.gestisci', { evento_id: ev('Primo').id, azione: 'aggiungi', email: 'paola@example.com' }));
  await login(page, env, 'paola@example.com');
  await apri(page, 'Primo set');
  await expect(page.locator('.giorno')).toHaveCount(1);
  await expect(page.locator('.giorno .names .nm')).toHaveCount(2);
  await expect(page.locator('.lv')).toHaveCount(0);
  await expect(page.locator('.giorno .riga')).toHaveCount(0);
  await expect(page.getByLabel('Aggiungi staff')).toHaveCount(0);
});
