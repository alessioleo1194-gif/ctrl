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

// ---------------- Fase 2: piano, materiale, scheda tecnica ----------------

async function openEvent(page, env, title = 'Cantelmo: Maria Mazzotta') {
  await login(page, env);
  await page.getByText(title).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('piano di produzione: compilo righe e testo, salvo, ritrovo; indicatore verde in lista', async ({ page }, info) => {
  const env = await setup(page);
  await openEvent(page, env);
  const sec = page.locator('#sec-piano');
  await expect(sec.getByText('Nessun orario, testo o file.')).toBeVisible();
  await sec.getByRole('button', { name: 'Compila' }).click();
  // una riga vuota pronta
  await sec.locator('#piano-0-ora_inizio').fill('15:00');
  await sec.locator('#piano-0-ora_fine').fill('17:30');
  await sec.locator('#piano-0-attivita').fill('Carico e montaggio');
  await sec.locator('#piano-0-responsabile').fill('Manuel');
  await sec.getByRole('button', { name: 'Aggiungi attività' }).click();
  await sec.locator('#piano-1-attivita').fill('Soundcheck');
  await sec.locator('#piano-1-ora_inizio').fill('18:00');
  await sec.getByLabel('Testo libero · Piano di produzione').fill('Ingresso carico da via Libertini');
  await page.screenshot({ path: `test-results/piano-modifica-${info.project.name}.png`, fullPage: true });
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByText('Piano di produzione salvato')).toBeVisible();
  await expect(sec.locator('table')).toContainText('Carico e montaggio');
  await expect(sec.locator('table')).toContainText('17:30');
  await expect(sec.getByText('Ingresso carico da via Libertini')).toBeVisible();
  await expect(sec.locator('.sec-ico.piano.on')).toHaveCount(1);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/piano-${info.project.name}.png`, fullPage: true });

  // davvero nel database
  const sh = env.getSS(env.state.props.DB_ID).getSheetByName('attivita').rows().slice(1).filter(r => r[8] !== 'TRUE');
  expect(sh.map(r => r[4])).toEqual(['Carico e montaggio', 'Soundcheck']);
  // riordino: Soundcheck in alto, poi tolgo Carico
  await sec.getByRole('button', { name: 'Modifica' }).click();
  await sec.getByRole('button', { name: 'Sposta su riga 2' }).click();
  await sec.getByRole('button', { name: 'Togli riga 2' }).click();
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(sec.locator('tbody tr')).toHaveCount(1);
  await expect(sec.locator('tbody')).toContainText('Soundcheck');

  // indicatore in lista (su telefono si torna alla lista)
  if (info.project.name === 'mobile') await page.getByRole('link', { name: 'Eventi', exact: true }).click();
  const row = page.locator('.ev', { hasText: 'Cantelmo: Maria Mazzotta' });
  await expect(row.locator('.ind .piano.on')).toHaveCount(1);
  await expect(row.locator('.ind .materiale.on')).toHaveCount(0);
});

test('lista materiale: tendine dalle impostazioni, campo obbligatorio, annulla senza salvare', async ({ page }, info) => {
  const env = await setup(page);
  await openEvent(page, env);
  const sec = page.locator('#sec-materiale');
  await sec.getByRole('button', { name: 'Compila' }).click();
  await sec.locator('#materiale-0-quantita').fill('2');
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(sec.getByText('Riga 1: manca "Voce".')).toBeVisible();
  await sec.locator('#materiale-0-voce').fill('Cassa attiva 12"');
  await sec.locator('#materiale-0-area').selectOption('Audio');
  await sec.locator('#materiale-0-provenienza').selectOption('Da noleggiare');
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(sec.locator('table')).toContainText('Da noleggiare');
  await expect(sec.locator('.sec-ico.materiale.on')).toHaveCount(1);
  const r = env.getSS(env.state.props.DB_ID).getSheetByName('materiale').rows()[1];
  expect([r[2], r[3], r[4], r[5]]).toEqual(['Cassa attiva 12"', '2', 'Audio', 'Da noleggiare']);

  // annulla con modifiche chiede conferma e non salva
  await sec.getByRole('button', { name: 'Modifica' }).click();
  await sec.locator('#materiale-0-voce').fill('Cambiata');
  await sec.getByRole('button', { name: 'Annulla' }).click();
  await sec.getByRole('button', { name: 'Scarta modifiche?' }).click();
  await expect(sec.locator('table')).toContainText('Cassa attiva 12"');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/materiale-${info.project.name}.png`, fullPage: true });
});

test('scheda tecnica: channel list numerata, allego rider, scarico identico, tolgo il file', async ({ page }, info) => {
  const env = await setup(page);
  await openEvent(page, env);
  const sec = page.locator('#sec-scheda');
  await sec.getByRole('button', { name: 'Compila' }).click();
  await expect(sec.locator('#scheda-0-numero')).toHaveValue('1');
  await sec.locator('#scheda-0-sorgente').fill('Kick in');
  await sec.locator('#scheda-0-microfono').fill('Beta 91');
  await sec.getByRole('button', { name: 'Aggiungi canale' }).click();
  await expect(sec.locator('#scheda-1-numero')).toHaveValue('2');
  await sec.locator('#scheda-1-sorgente').fill('Basso');
  await sec.locator('#scheda-1-di').fill('DI attiva');
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(sec.locator('tbody tr')).toHaveCount(2);

  // allega un file (contenuto binario)
  const content = Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 256));
  await sec.getByLabel('Allega file a Scheda tecnica').setInputFiles({ name: 'rider band.pdf', mimeType: 'application/pdf', buffer: content });
  await expect(page.getByText('File caricato')).toBeVisible();
  await expect(sec.getByText('rider band.pdf')).toBeVisible();
  const driveFile = [...env.state.drive.files.values()].find(f => f.name === 'rider band.pdf');
  expect(Buffer.from(driveFile.bytes.map(b => (b + 256) % 256)).equals(content)).toBe(true);
  await page.screenshot({ path: `test-results/scheda-${info.project.name}.png`, fullPage: true });

  // scarica: stesso contenuto
  const [dl] = await Promise.all([page.waitForEvent('download'), sec.getByRole('button', { name: /Scarica rider band\.pdf/ }).click()]);
  expect(dl.suggestedFilename()).toBe('rider band.pdf');
  const fs = await import('node:fs');
  expect(fs.readFileSync(await dl.path()).equals(content)).toBe(true);

  // file troppo grande: rifiutato senza caricarlo
  await sec.getByLabel('Allega file a Scheda tecnica').setInputFiles({ name: 'video.mov', mimeType: 'video/quicktime', buffer: Buffer.alloc(21 * 1024 * 1024) });
  await expect(sec.getByText('video.mov: troppo grande (max 20 MB)')).toBeVisible();

  // togli con conferma: finisce nel cestino di Drive
  await sec.getByRole('button', { name: 'Togli rider band.pdf' }).click();
  await sec.getByRole('button', { name: 'Conferma: togli rider band.pdf' }).click();
  await expect(page.getByText('File spostato nel cestino di Drive')).toBeVisible();
  await expect(sec.getByText('rider band.pdf')).toHaveCount(0);
  expect(driveFile.trashed).toBe(true);
  await noHorizontalScroll(page);
});

test('sola lettura: vede e scarica, nessuna modifica né caricamento', async ({ page }) => {
  const env = await setup(page);
  const tk = (email) => {
    env.state.cache.clear();
    env.ctx.handleRequest(JSON.stringify({ action: 'auth.requestCode', payload: { email } }));
    const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
    return env.ctx.handleRequest(JSON.stringify({ action: 'auth.verifyCode', payload: { email, code } })).data.token;
  };
  const adm = tk(ADMIN);
  const evId = env.ctx.handleRequest(JSON.stringify({ action: 'eventi.list', token: adm })).data.find(e => e.titolo === 'Convegno Museo Castromediano').id;
  env.ctx.handleRequest(JSON.stringify({ action: 'sezioni.righe', token: adm, payload: { evento_id: evId, sezione: 'materiale', versione: '0', righe: [{ voce: 'Proiettore', quantita: '1' }] } }));
  env.ctx.handleRequest(JSON.stringify({ action: 'allegati.carica', token: adm, payload: { evento_id: evId, sezione: 'piano', nome: 'piano.pdf', mime: 'application/pdf', dati: Buffer.from('PIANO').toString('base64') } }));
  env.ctx.handleRequest(JSON.stringify({ action: 'utenti.save', token: adm, payload: { email: 'tecnico@example.com', nome: 'Tecnico', ruolo: 'LETTURA' } }));
  await login(page, env, 'tecnico@example.com');
  await page.getByText('Convegno Museo Castromediano').click();
  await expect(page.locator('#sec-materiale table')).toContainText('Proiettore');
  await expect(page.getByRole('button', { name: 'Modifica' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compila' })).toHaveCount(0);
  await expect(page.getByText('Allega file')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Togli/ })).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica piano\.pdf/ }).click()]);
  const fs = await import('node:fs');
  expect(fs.readFileSync(await dl.path()).toString()).toBe('PIANO');
});

test('conflitto: se un altro salva prima, avviso chiaro e nessuna sovrascrittura', async ({ page }) => {
  const env = await setup(page);
  await openEvent(page, env);
  const sec = page.locator('#sec-piano');
  await sec.getByRole('button', { name: 'Compila' }).click();
  await sec.locator('#piano-0-attivita').fill('Mia versione');
  // nel frattempo qualcun altro salva la stessa sezione
  env.state.cache.clear();
  env.ctx.handleRequest(JSON.stringify({ action: 'auth.requestCode', payload: { email: ADMIN } }));
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  const t2 = env.ctx.handleRequest(JSON.stringify({ action: 'auth.verifyCode', payload: { email: ADMIN, code } })).data.token;
  const evId = env.ctx.handleRequest(JSON.stringify({ action: 'eventi.list', token: t2 })).data.find(e => e.titolo === 'Cantelmo: Maria Mazzotta').id;
  env.ctx.handleRequest(JSON.stringify({ action: 'sezioni.righe', token: t2, payload: { evento_id: evId, sezione: 'piano', versione: '0', righe: [{ attivita: 'Versione altrui' }] } }));
  await sec.getByRole('button', { name: 'Salva' }).click();
  await expect(sec.getByText(/Qualcun altro ha appena modificato questa sezione/)).toBeVisible();
  const vivi = env.getSS(env.state.props.DB_ID).getSheetByName('attivita').rows().slice(1).map(r => r[4]);
  expect(vivi).toEqual(['Versione altrui']);
});
