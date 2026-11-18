/**
 * Misura strutturale del backend con Google simulato: quante letture di fogli (getDataRange) fa ogni azione.
 * Ogni lettura reale su Apps Script costa circa 100-400 ms: meno letture = risposta più rapida.
 * Uso: node scripts/perf-mock.mjs
 */
import { loadBackend, call } from '../tests/mocks/google.mjs';

const ADMIN = 'admin@example.com';
const DB = '1QULIEIzC0ckd7oZ9aeNvyObtM3vNA-5P-hEVDBQpO4I';
const env = loadBackend({ adminEmail: ADMIN, calendarEvents: [] });
env.ctx.setupProduzione();
const login = (email) => {
  env.state.cache.clear();
  call(env.ctx, 'auth.requestCode', { email });
  const code = env.state.mails.at(-1).subject.match(/(\d{6})/)[1];
  return call(env.ctx, 'auth.verifyCode', { email, code }).data.token;
};
const t = login(ADMIN);
const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.data; };
call(env.ctx, 'utenti.save', { email: 'marco@example.com', nome: 'Marco Serra', ruolo: 'PRODUCTION' }, t);
const eventi = [];
for (let i = 0; i < 40; i++) {
  const d = `2026-12-${String(1 + (i % 28)).padStart(2, '0')}`;
  eventi.push(ok(call(env.ctx, 'eventi.create', { titolo: 'Evento ' + i, data: d, data_fine: d, ora_inizio: '21:00', ora_fine: '23:00', luogo: 'Lecce' }, t)));
}
for (const e of eventi.slice(0, 10)) call(env.ctx, 'staff.gestisci', { evento_id: e.id, azione: 'aggiungi', email: 'marco@example.com' }, t);
const pr = ok(call(env.ctx, 'produzione.assicura', { evento_id: eventi[0].id }, t));
call(env.ctx, 'documento.salva', { produzione_id: pr.id, tipo: 'plan', versione: '0', dati: { crew: [], giorni: [{ data: '2026-12-01', righe: [{ att: 'Load-in', ora: '14:00' }] }] } }, t);

// conta le letture dei fogli
let letture = 0; const per = {};
const sh = env.getSS(DB).getSheetByName('eventi');
const proto = Object.getPrototypeOf(sh);
const orig = proto.getDataRange;
proto.getDataRange = function () { letture++; per[this.name || this.getName?.() || '?'] = (per[this.name || this.getName?.() || '?'] || 0) + 1; return orig.call(this); };

const azioni = [
  ['auth.me', {}], ['impostazioni.get', {}], ['eventi.list', {}], ['eventi.get', { id: eventi[0].id }],
  ['staff.evento', { evento_id: eventi[0].id }], ['report.righe', {}], ['report.statistiche', {}],
  ['documento.get', { produzione_id: pr.id, tipo: 'plan' }], ['app.avvio', {}]
];
const righe = [];
for (const [a, p] of azioni) {
  letture = 0; for (const k of Object.keys(per)) delete per[k];
  env.ctx.Db.clearCache();   // come su Apps Script: ogni richiesta è un'esecuzione nuova, senza cache
  const s = performance.now();
  const r = call(env.ctx, a, p, t);
  const ms = performance.now() - s;
  righe.push({ azione: a, ok: r.ok, letture, ms: Math.round(ms * 10) / 10, tabelle: Object.entries(per).map(([k, v]) => k + (v > 1 ? '×' + v : '')).join(' ') });
}
console.table(righe);
